import { resolve } from 'node:path';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  addUserMessage,
  createConversation,
  failExpert,
  finishTurn,
  nextTurns,
  setBudget,
  startTurn,
  stop,
  type ConversationState,
  type TurnInput,
} from '../conversation.js';
import type { Expert, StatusEvent } from '../experts/types.js';
import { t } from '../i18n.js';
import { renderTurnInput } from '../prompts.js';
import { EXPERT_IDS, parseAddress, parseCommand, type Command, type ExpertId, type Target } from '../protocol.js';
import { appendMessage, writeDecision, writeDone, type DoneWord, type Room } from '../room.js';
import { InputBar } from './InputBar.js';
import { Markdown } from './Markdown.js';
import { StatusLine, type Activity } from './StatusLine.js';
import { Transcript } from './Transcript.js';

type Mode = 'chat' | 'closing' | 'draft' | 'ending';

export interface View {
  state: ConversationState;
  activity: Record<ExpertId, Activity>;
  mode: Mode;
  draft: string;
  notice: string;
}

export interface SessionDeps {
  experts: Record<ExpertId, Expert>;
  roomDir: string;
  exit: () => void;
}

const idle = (): Activity => ({ status: t().thinking, note: '' });

function addObjections(draft: string, author: ExpertId, objections: string): string {
  const text = objections.replace(t().objectionsStrip, '').trim();
  const block = `${t().objectionsBy(t().authors[author])}\n${text}\n\n`;
  const anchor = new RegExp(`^${t().verifiedHeading}:`, 'm').exec(draft);
  return anchor ? `${draft.slice(0, anchor.index)}${block}${draft.slice(anchor.index)}` : `${draft.trimEnd()}\n${block}`;
}

/** Drives conversation state, expert turns and room files; React only renders its `View`. */
export class ChatSession {
  private view: View = {
    state: createConversation(),
    activity: { claude: idle(), gpt: idle() },
    mode: 'chat',
    draft: '',
    notice: '',
  };
  private readonly listeners = new Set<() => void>();
  private readonly running = new Set<Promise<void>>();
  private writes: Promise<void> = Promise.resolve();
  private drafter: ExpertId | undefined;
  private closeRun = 0;

  constructor(private readonly deps: SessionDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): View => this.view;

  post(target: Target, text: string): void {
    this.setState(addUserMessage(this.view.state, target, text));
    this.update({ notice: '' });
    this.pump();
  }

  /** In the close flow this abandons the draft and returns to a paused chat. */
  stopTurns(): void {
    if (this.view.mode === 'ending') return;
    this.closeRun++;
    this.update({ mode: 'chat' });
    this.stopBusyExperts();
    this.setState(stop(this.view.state));
  }

  setBudget(value: number): void {
    this.setState(setBudget(this.view.state, value));
    this.pump();
  }

  notify(notice: string): void {
    this.update({ notice });
  }

  /** Also the path for a closed window or Ctrl+C (`interrupted`). */
  async quit(word: DoneWord = 'quit'): Promise<void> {
    if (this.view.mode === 'ending') return;
    this.update({ mode: 'ending' });
    this.stopBusyExperts();
    // The stopped turns still save their partial replies.
    await Promise.allSettled([...this.running]);
    await this.end(word);
  }

  async close(): Promise<void> {
    if (this.view.mode !== 'chat') return;
    const run = ++this.closeRun;
    this.update({ mode: 'closing' });
    this.stopBusyExperts();
    await Promise.allSettled([...this.running]);
    const draft = await this.firstDraft(run);
    if (!this.isCurrent(run)) return;
    if (draft === undefined) return this.conclude(t().noDecision);
    this.update({ mode: 'draft', draft });
  }

  /** Empty text accepts the draft; anything else is a revision request. */
  async answerDraft(text: string): Promise<void> {
    if (this.view.mode !== 'draft') return;
    if (text === '') return this.conclude(this.view.draft);
    const run = ++this.closeRun;
    this.update({ mode: 'closing' });
    // A plain message, so the correction stays in the transcript and the other expert sees it after /stop.
    this.setState(addUserMessage(this.view.state, 'both', text));
    const revised = this.drafter && (await this.ask(run, this.drafter, t().revisionPrompt(this.view.draft)));
    if (this.isCurrent(run)) this.update({ mode: 'draft', draft: revised || this.view.draft });
  }

  private async firstDraft(run: number): Promise<string | undefined> {
    for (const id of EXPERT_IDS.filter((candidate) => !this.view.state.experts[candidate].error)) {
      const draft = await this.ask(run, id, t().draftPrompt);
      if (draft) {
        this.drafter = id;
        return this.withObjections(run, draft, id);
      }
    }
    return undefined;
  }

  private async withObjections(run: number, draft: string, drafter: ExpertId): Promise<string> {
    const reviewer = EXPERT_IDS.find((id) => id !== drafter && !this.view.state.experts[id].error);
    const objections = reviewer && (await this.ask(run, reviewer, t().objectionsPrompt(draft)));
    return reviewer && objections ? addObjections(draft, reviewer, objections) : draft;
  }

  /**
   * A close-flow turn that also carries what the expert has not seen yet. It is tracked like a chat
   * turn, so a new /close waits for it, and yields undefined once its close run was abandoned.
   */
  private async ask(run: number, id: ExpertId, prompt: string): Promise<string | undefined> {
    if (!this.isCurrent(run)) return undefined;
    const input = this.begin(id);
    const turn = this.deps.experts[id]
      .runTurn(renderTurnInput(input, prompt), (event) => this.onEvent(id, event))
      .then(
        ({ text }) => text,
        (error: unknown) => {
          this.setState(failExpert(this.view.state, id, errorMessage(error)));
          return undefined;
        },
      );
    await this.track(turn.then(() => this.setBusy(id, false)));
    return this.isCurrent(run) ? turn : undefined;
  }

  private async conclude(decision: string): Promise<void> {
    this.update({ mode: 'ending' });
    const transcript = resolve(this.deps.roomDir, 'transcript.md');
    await writeDecision(this.deps.roomDir, `${decision.trimEnd()}\n${t().transcriptLine(transcript)}\n`);
    await this.end('closed');
  }

  private async end(word: DoneWord): Promise<void> {
    await this.writes;
    await writeDone(this.deps.roomDir, word);
    this.deps.exit();
  }

  /** True while close run `run` is still the active one; /stop and a newer /close abandon it. */
  private isCurrent(run: number): boolean {
    return this.view.mode === 'closing' && run === this.closeRun;
  }

  private pump(): void {
    if (this.view.mode === 'chat') nextTurns(this.view.state).forEach((id) => this.launch(id));
  }

  private launch(id: ExpertId): void {
    const input = this.begin(id);
    void this.track(
      this.deps.experts[id].runTurn(renderTurnInput(input), (event) => this.onEvent(id, event)).then(
        (result) => this.setState(finishTurn(this.view.state, id, result)),
        (error) => this.setState(failExpert(this.view.state, id, errorMessage(error))),
      ),
    );
  }

  private begin(id: ExpertId): TurnInput {
    const { state, input } = startTurn(this.view.state, id);
    this.setState(state);
    this.setActivity(id, idle());
    return input;
  }

  /** Every expert call is tracked so /close can wait for it, and the scheduler runs again once it settles. */
  private track(work: Promise<void>): Promise<void> {
    const tracked = work.then(() => {
      this.running.delete(tracked);
      this.pump();
    });
    this.running.add(tracked);
    return tracked;
  }

  private stopBusyExperts(): void {
    EXPERT_IDS.filter((id) => this.view.state.experts[id].busy).forEach((id) => this.deps.experts[id].stop());
  }

  private onEvent(id: ExpertId, event: StatusEvent): void {
    const current = this.view.activity[id];
    this.setActivity(id, event.kind === 'note' ? { ...current, note: event.text } : { ...current, status: event.text });
  }

  private setBusy(id: ExpertId, busy: boolean): void {
    const expert = this.view.state.experts[id];
    this.setState({ ...this.view.state, experts: { ...this.view.state.experts, [id]: { ...expert, busy } } });
  }

  private setActivity(id: ExpertId, activity: Activity): void {
    this.update({ activity: { ...this.view.activity, [id]: activity } });
  }

  private setState(state: ConversationState): void {
    for (const message of state.messages.slice(this.view.state.messages.length)) {
      this.writes = this.writes
        .then(() => appendMessage(this.deps.roomDir, message))
        .catch((error: unknown) => this.update({ notice: t().transcriptWriteFailed(errorMessage(error)) }));
    }
    this.update({ state });
  }

  private update(patch: Partial<View>): void {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runCommand(session: ChatSession, command: Command): void {
  switch (command.name) {
    case 'stop':
      return session.stopTurns();
    case 'close':
      return void session.close();
    case 'quit':
      return void session.quit();
    case 'budget':
      return session.setBudget(command.value);
    case 'invalid':
      return session.notify(command.reason);
  }
}

function submitInput(session: ChatSession, mode: Mode, raw: string): void {
  const text = raw.trim();
  const command = parseCommand(text);
  if (command?.name === 'quit' || command?.name === 'stop') return runCommand(session, command);
  if (mode === 'draft') return command ? session.notify(t().draftHint) : void session.answerDraft(text);
  if (mode === 'closing' && text !== '') return session.notify(t().closingHint);
  if (mode !== 'chat' || text === '') return;
  if (command) return runCommand(session, command);
  const message = parseAddress(text);
  if (message.text !== '') session.post(message.target, message.text);
}

const CLEAR_SCREEN_AND_SCROLLBACK = '\x1b[2J\x1b[3J\x1b[H';
const RESIZE_SETTLE_MS = 100;

/** History printed at the old width cannot reflow, so a resize wipes the screen and reprints it (as Claude Code does). */
const INTERRUPT_SIGNALS = ['SIGHUP', 'SIGTERM', 'SIGINT'] as const;

function useInterruptSignals(session: ChatSession): void {
  useEffect(() => {
    const interrupt = () => void session.quit('interrupted');
    INTERRUPT_SIGNALS.forEach((signal) => process.once(signal, interrupt));
    return () => INTERRUPT_SIGNALS.forEach((signal) => process.off(signal, interrupt));
  }, [session]);
  // In raw mode Ctrl+C arrives as a key, not as SIGINT.
  useInput((input, key) => {
    if (key.ctrl && input === 'c') void session.quit('interrupted');
  });
}

function useRedrawOnResize(): number {
  const { stdout } = useStdout();
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    const redraw = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stdout.write(CLEAR_SCREEN_AND_SCROLLBACK);
        setEpoch((value) => value + 1);
      }, RESIZE_SETTLE_MS);
    };
    stdout.on('resize', redraw);
    return () => {
      clearTimeout(timer);
      stdout.off('resize', redraw);
    };
  }, [stdout]);
  return epoch;
}

export interface AppProps {
  roomDir: string;
  room: Room;
  experts: Record<ExpertId, Expert>;
}

export function App({ roomDir, room, experts }: AppProps) {
  const { exit } = useApp();
  const [session] = useState(() => new ChatSession({ experts, roomDir, exit }));
  const view = useSyncExternalStore(session.subscribe, session.getView);
  useEffect(() => session.post('both', room.brief), [session, room.brief]);
  useInterruptSignals(session);
  const epoch = useRedrawOnResize();

  const hint = view.mode === 'draft' ? t().draftHint : t().chatHint;
  return (
    <Box flexDirection="column">
      <Transcript key={epoch} topic={room.config.topic} messages={view.state.messages} />
      {view.mode === 'draft' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{t().draftTitle}</Text>
          <Markdown text={view.draft} />
        </Box>
      ) : null}
      {view.notice ? <Text color="yellow">{view.notice}</Text> : null}
      <StatusLine state={view.state} activity={view.activity} />
      <InputBar hint={hint} onSubmit={(text) => submitInput(session, view.mode, text)} />
    </Box>
  );
}
