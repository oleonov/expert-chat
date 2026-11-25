import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expert, StatusEvent, TurnResult } from '../src/experts/types.js';
import { setLang } from '../src/i18n.js';
import { loadRoom } from '../src/room.js';
import { App } from '../src/ui/App.js';

const DRAFT = 'Вопрос: q\nРешение: r\nСпорное: -\nПроверено в коде: a.ts:1 → ок\nОткрыто: -';

const result = (text: string, interrupted = false): TurnResult => ({ text, status: 'checking', interrupted, tokens: 10 });

/** Scripted expert: `held` turns stay open until `stop()`, the others answer from `reply`. */
class FakeExpert implements Expert {
  inputs: string[] = [];
  active = 0;
  fail: string | undefined;
  held = false;
  /** How long a stopped turn takes to wind down, like a real CLI being killed. */
  stopDelay = 0;
  maxActive = 0;
  private release: (() => void) | undefined;

  constructor(
    readonly name: string,
    private readonly log: string[],
    public reply: (input: string) => string,
  ) {}

  async runTurn(input: string, onStatus: (event: StatusEvent) => void): Promise<TurnResult> {
    const n = this.inputs.push(input);
    this.log.push(`start ${this.name}#${n}`);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    onStatus({ kind: 'status', text: 'читает a.ts' });
    try {
      if (this.fail) throw new Error(this.fail);
      if (this.held && n === 1) {
        await new Promise<void>((resolve) => (this.release = resolve));
        return result('частично', true);
      }
      return result(this.reply(input));
    } finally {
      this.active--;
      this.log.push(`end ${this.name}#${n}`);
    }
  }

  stop(): void {
    const release = this.release;
    if (this.stopDelay > 0) setTimeout(() => release?.(), this.stopDelay);
    else release?.();
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('App', () => {
  let dir: string;
  let log: string[];
  let claude: FakeExpert;
  let gpt: FakeExpert;
  let app: ReturnType<typeof render> | undefined;

  const reply = (input: string) => (input.includes('черновик итога') && !input.includes('Вот черновик') ? DRAFT : 'ответ');

  async function open() {
    const room = await loadRoom(dir);
    app = render(<App roomDir={dir} room={room} experts={{ claude, gpt }} />);
  }

  async function type(text: string) {
    app?.stdin.write(text);
    await tick();
    app?.stdin.write('\r');
    await tick();
  }

  const doneWord = () => readFile(join(dir, 'done'), 'utf8');

  beforeAll(() => setLang('ru'));

  beforeEach(async () => {
    setLang('ru');
    dir = await mkdtemp(join(tmpdir(), 'app-room-'));
    await writeFile(join(dir, 'brief.md'), 'Разберите задачу X');
    await writeFile(join(dir, 'room.json'), JSON.stringify({ topic: 'Тема', workdir: dir, models: { claude: 'c', codex: 'x' } }));
    log = [];
    claude = new FakeExpert('claude', log, reply);
    gpt = new FakeExpert('gpt', log, reply);
  });

  afterEach(() => app?.unmount());

  it('start_englishRoom_showsEnglishLabelsAndStatusLine', async () => {
    await writeFile(
      join(dir, 'room.json'),
      JSON.stringify({ topic: 'Topic', workdir: dir, models: { claude: 'c', codex: 'x' }, lang: 'en' }),
    );
    setLang('en');
    claude.held = true;
    gpt.held = true;
    await open();
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Claude читает a.ts'));

    const frame = app?.lastFrame() ?? '';
    expect(frame).toContain('❯ You\n  Разберите задачу X');
    expect(frame).toContain('turns 0 of 8');
    expect(frame).toContain('/stop /close /quit /budget N');
    expect(claude.inputs[0]).toContain('[You] Разберите задачу X');
    expect(claude.inputs[0]).toContain('[[status: checking|disputing|agree|pass]]');
  });

  it('start_withBrief_postsItToBothAndShowsTheirStatuses', async () => {
    claude.held = true;
    gpt.held = true;
    await open();
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Claude читает a.ts'));

    const frame = app?.lastFrame() ?? '';
    expect(frame).toContain('❯ Ты\n  Разберите задачу X');
    expect(frame).toContain('GPT читает a.ts');
    expect(frame).toContain('ходов 0 из 8');
    expect(claude.inputs[0]).toContain('[Ты] Разберите задачу X');
    expect(gpt.inputs[0]).toContain('[Ты] Разберите задачу X');
    await vi.waitFor(async () => expect(await readFile(join(dir, 'transcript.jsonl'), 'utf8')).toContain('Разберите задачу X'));
  });

  it('quit_typed_writesDoneQuit', async () => {
    claude.held = true;
    gpt.held = true;
    await open();
    await type('/quit');
    await vi.waitFor(async () => expect(await doneWord()).toBe('quit'));
  });

  it('quit_duringActiveTurns_startsNoFurtherTurn', async () => {
    claude.held = true;
    gpt.held = true;
    await open();
    await vi.waitFor(() => expect(gpt.active).toBe(1));
    await type('/quit');
    await vi.waitFor(async () => expect(await doneWord()).toBe('quit'));
    await tick();
    expect([claude.inputs.length, gpt.inputs.length]).toEqual([1, 1]);
  });

  it('quit_duringActiveTurn_savesThePartialReplyBeforeDone', async () => {
    claude.held = true;
    gpt.held = true;
    claude.stopDelay = 100;
    gpt.stopDelay = 100;
    await open();
    await vi.waitFor(() => expect(gpt.active).toBe(1));
    await type('/quit');
    await vi.waitFor(async () => expect(await doneWord()).toBe('quit'));
    expect(await readFile(join(dir, 'transcript.jsonl'), 'utf8')).toContain('частично');
  });

  it('ctrlC_duringActiveTurn_savesThePartialReplyAndWritesInterrupted', async () => {
    claude.held = true;
    gpt.held = true;
    claude.stopDelay = 100;
    gpt.stopDelay = 100;
    await open();
    await vi.waitFor(() => expect(gpt.active).toBe(1));
    app?.stdin.write('\u0003');
    await vi.waitFor(async () => expect(await doneWord()).toBe('interrupted'));
    expect(await readFile(join(dir, 'transcript.jsonl'), 'utf8')).toContain('частично');
  });

  it('close_userMessageQueuedDuringTurns_reachesTheDrafter', async () => {
    claude.held = true;
    gpt.held = true;
    await open();
    await vi.waitFor(() => expect(gpt.active).toBe(1));
    await type('ПОСЛЕДНЯЯ ПОПРАВКА');
    await type('/close');
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Черновик итога'));
    expect(claude.inputs[1]).toContain('ПОСЛЕДНЯЯ ПОПРАВКА');
    expect(claude.inputs[1]).toContain('частично');
  });

  it('quit_whileDraftShown_quitsInsteadOfRevising', async () => {
    gpt.fail = 'x';
    await open();
    await vi.waitFor(() => expect(claude.active).toBe(0));
    await type('/close');
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Черновик итога'));
    const asked = claude.inputs.length;
    await type('/quit');
    await vi.waitFor(async () => expect(await doneWord()).toBe('quit'));
    expect(claude.inputs).toHaveLength(asked);
  });

  it('stop_whileDrafting_returnsToChatWithoutDecision', async () => {
    gpt.fail = 'x';
    await open();
    await vi.waitFor(() => expect(claude.active).toBe(0));
    claude.held = true;
    claude.inputs = [];
    await type('/close');
    await vi.waitFor(() => expect(claude.active).toBe(1));
    await type('/stop');
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('пауза'));
    expect(app?.lastFrame()).not.toContain('Черновик итога');
    await expect(doneWord()).rejects.toThrow();
  });

  it('close_rightAfterStoppingADraft_waitsForItAndShowsOnlyTheNewDraft', async () => {
    gpt.fail = 'x';
    await open();
    await vi.waitFor(() => expect(claude.active).toBe(0));
    claude.held = true;
    claude.stopDelay = 150;
    claude.inputs = [];
    claude.maxActive = 0;
    claude.reply = () => 'Вопрос: q\nРешение: новое';
    await type('/close');
    await vi.waitFor(() => expect(claude.active).toBe(1));
    await type('/stop');
    await type('/close');
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Решение: новое'));
    expect(claude.maxActive).toBe(1);
  });

  it('post_afterStoppingADraft_reachesTheExpertOnceItWindsDown', async () => {
    gpt.fail = 'x';
    await open();
    await vi.waitFor(() => expect(claude.active).toBe(0));
    claude.held = true;
    claude.stopDelay = 150;
    claude.inputs = [];
    await type('/close');
    await vi.waitFor(() => expect(claude.active).toBe(1));
    await type('/stop');
    await type('ЕЩЁ ВОПРОС');
    await vi.waitFor(() => expect(claude.inputs.at(-1)).toContain('ЕЩЁ ВОПРОС'));
  });

  it('close_oneExpertErrored_completesWithoutItsObjectionsTurn', async () => {
    gpt.fail = 'лимит подписки';
    await open();
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('✗ GPT ошибка'));
    await vi.waitFor(() => expect(claude.active).toBe(0));

    await type('/close');
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Черновик итога'));
    expect(claude.inputs).toHaveLength(2);
    expect(gpt.inputs).toHaveLength(1);

    await type('');
    await vi.waitFor(async () => expect(await doneWord()).toBe('closed'));
    const decision = await readFile(join(dir, 'decision.md'), 'utf8');
    expect(decision).toContain('Решение: r');
    expect(decision).toContain(`Переписка: ${join(dir, 'transcript.md')}`);
  });

  it('close_duringActiveTurns_stopsThemBeforeDraftingWithoutOverlap', async () => {
    claude.held = true;
    gpt.held = true;
    await open();
    await vi.waitFor(() => expect(claude.active).toBe(1));

    await type('/close');
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Черновик итога'));

    const at = (entry: string) => log.indexOf(entry);
    expect(at('end claude#1')).toBeGreaterThan(-1);
    expect(at('start claude#2')).toBeGreaterThan(at('end claude#1'));
    expect(at('start claude#2')).toBeGreaterThan(at('end gpt#1'));
    await vi.waitFor(async () => expect(await readFile(join(dir, 'transcript.md'), 'utf8')).toContain('(прервано) частично'));
  });

  it('close_bothExpertsErrored_writesNoDecisionAndCloses', async () => {
    claude.fail = 'упал';
    gpt.fail = 'упал';
    await open();
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Claude ошибка'));
    await type('/close');
    await vi.waitFor(async () => expect(await doneWord()).toBe('closed'));
    expect(await readFile(join(dir, 'decision.md'), 'utf8')).toContain('Решение: не сформировано (оба эксперта выбыли)');
  });

  it('close_revisionTyped_asksTheDrafterAndShowsTheNewDraft', async () => {
    gpt.fail = 'x';
    await open();
    await vi.waitFor(() => expect(claude.active).toBe(0));
    await type('/close');
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Черновик итога'));

    claude.reply = () => 'Вопрос: q\nРешение: исправлено';
    await type('поправь решение');
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Решение: исправлено'));
    expect(claude.inputs.at(-1)).toContain('[Ты] поправь решение');
    await vi.waitFor(async () => expect(await readFile(join(dir, 'transcript.jsonl'), 'utf8')).toContain('поправь решение'));
  });

  it('submit_whileTheDraftIsBeingWritten_saysToWaitInsteadOfDroppingSilently', async () => {
    gpt.fail = 'x';
    await open();
    await vi.waitFor(() => expect(claude.active).toBe(0));
    claude.held = true;
    claude.inputs = [];
    await type('/close');
    await vi.waitFor(() => expect(claude.active).toBe(1));
    await type('ещё мысль');
    await vi.waitFor(() => expect(app?.lastFrame()).toContain('Итог ещё пишется'));
  });
});
