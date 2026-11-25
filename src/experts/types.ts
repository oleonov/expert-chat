import type { Status } from '../protocol.js';

export type StatusEvent = { kind: 'status'; text: string } | { kind: 'note'; text: string };

export interface TurnResult {
  text: string;
  status: Status;
  interrupted: boolean;
  tokens: number;
}

export interface Expert {
  /** Rejects when the CLI fails; resolves with `interrupted` after `stop()`. */
  runTurn(input: string, onStatus: (event: StatusEvent) => void): Promise<TurnResult>;
  stop(): void;
}

/** Turns the JSON events of one CLI turn into status events and the final result. */
export interface TurnParser {
  consume(event: unknown): StatusEvent[];
  readonly text: string;
  readonly tokens: number;
  readonly sessionId: string | undefined;
  readonly error: string | undefined;
}

export interface ExpertOptions {
  model: string;
  effort: string;
  workdir: string;
  rules: string;
  log?: (line: string) => void;
}
