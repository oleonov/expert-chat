import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { t } from '../i18n.js';
import { parseReply } from '../protocol.js';
import type { Expert, ExpertOptions, StatusEvent, TurnParser, TurnResult } from './types.js';

const STDERR_TAIL_CHARS = 2000;
const ERROR_SUMMARY_CHARS = 300;
const KILL_GRACE_MS = 3000;

export interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  onLine: (line: string) => void;
}

export interface ProcessExit {
  code: number | null;
  stderrTail: string;
}

export interface RunningProcess {
  done: Promise<ProcessExit>;
  kill(): void;
}

const liveGroups = new Set<number>();

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // group already gone
  }
}

// The SIGTERM grace timer dies with this process, so whatever is still running goes down hard on exit.
process.on('exit', () => liveGroups.forEach((pid) => killGroup(pid, 'SIGKILL')));

/** Spawns a CLI in its own process group, feeds `stdin`, and reports stdout line by line. */
export function runProcess(spec: ProcessSpec): RunningProcess {
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderrTail = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
  });
  child.on('error', (error) => {
    stderrTail = error.message;
  });
  child.stdin.on('error', () => {});
  child.stdin.end(spec.stdin);

  const lines = createInterface({ input: child.stdout });
  lines.on('line', spec.onLine);
  const pid = child.pid;
  if (pid) liveGroups.add(pid);
  child.on('exit', () => {
    if (!pid) return;
    // On 'exit', not 'close': a leftover descendant holding the pipes open would otherwise keep 'close' from firing.
    killGroup(pid, 'SIGKILL');
    liveGroups.delete(pid);
  });
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve));
  const drained = new Promise<void>((resolve) => lines.on('close', resolve));
  const done = Promise.all([exited, drained]).then(([code]) => ({ code, stderrTail }));

  return {
    done,
    kill() {
      if (!pid) return;
      killGroup(pid, 'SIGTERM');
      setTimeout(() => killGroup(pid, 'SIGKILL'), KILL_GRACE_MS).unref();
    },
  };
}

export interface CliCommand {
  command: string;
  args: string[];
  stdin: string;
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function summarizeFailure(code: number | null, stderrTail: string): string {
  const lastLine = stderrTail.trim().split('\n').at(-1) ?? '';
  return t().exitCode(code, lastLine).slice(0, ERROR_SUMMARY_CHARS);
}

/** Shared turn lifecycle of both CLI experts; subclasses only say how to call and how to read the CLI. */
export abstract class CliExpert implements Expert {
  private running: RunningProcess | undefined;
  private stopped = false;
  private sessionId: string | undefined;
  /** Input a stopped turn sent before the CLI opened a session; the first real session must still get it. */
  private unacknowledged = '';

  constructor(protected readonly options: ExpertOptions) {}

  abstract command(input: string, sessionId: string | undefined): CliCommand;
  protected abstract createParser(): TurnParser;

  async runTurn(input: string, onStatus: (event: StatusEvent) => void): Promise<TurnResult> {
    const parser = this.createParser();
    const fullInput = this.unacknowledged ? `${this.unacknowledged}\n\n${input}` : input;
    this.stopped = false;
    this.running = runProcess({
      ...this.command(fullInput, this.sessionId),
      cwd: this.options.workdir,
      onLine: (line) => {
        this.options.log?.(line);
        const event = parseJson(line);
        if (event !== undefined) parser.consume(event).forEach(onStatus);
      },
    });
    const exit = await this.running.done;
    this.running = undefined;
    this.sessionId = parser.sessionId ?? this.sessionId;
    this.unacknowledged = this.sessionId ? '' : fullInput;
    return this.toResult(parser, exit);
  }

  stop(): void {
    this.stopped = true;
    this.running?.kill();
  }

  private toResult(parser: TurnParser, exit: ProcessExit): TurnResult {
    const { text, status } = parseReply(parser.text);
    if (!this.stopped) {
      if (parser.error) throw new Error(parser.error);
      if (exit.code !== 0) throw new Error(summarizeFailure(exit.code, exit.stderrTail));
      if (parser.text.trim() === '') throw new Error(t().emptyReply);
    }
    return { text, status, interrupted: this.stopped, tokens: parser.tokens };
  }
}
