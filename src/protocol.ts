export const EXPERT_IDS = ['claude', 'gpt'] as const;
export type ExpertId = (typeof EXPERT_IDS)[number];
export type Target = ExpertId | 'both';

export const STATUSES = ['checking', 'disputing', 'agree', 'pass'] as const;
export type Status = (typeof STATUSES)[number];

export const DEFAULT_STATUS: Status = 'checking';

const STATUS_MARKER = /\s*\[\[status:\s*([^\]]*?)\s*\]\]\s*$/i;
const ADDRESS = /^@(claude|gpt)(?:\s+|$)/i;

export interface ParsedReply {
  text: string;
  status: Status;
}

import { t } from './i18n.js';

export type Command =
  | { name: 'stop' | 'close' | 'quit' }
  | { name: 'budget'; value: number }
  | { name: 'invalid'; reason: string };

function toStatus(word: string): Status {
  return STATUSES.find((status) => status === word.toLowerCase()) ?? DEFAULT_STATUS;
}

const OWN_LABEL = /^\[(?:Claude|GPT)\]\s*/;

export function parseReply(raw: string): ParsedReply {
  const marker = STATUS_MARKER.exec(raw);
  const body = marker ? raw.slice(0, marker.index) : raw;
  // Models echo the transcript's `[Label]` prefix back at the start of their own reply.
  const text = body.trim().replace(OWN_LABEL, '');
  return { text, status: marker ? toStatus(marker[1] ?? '') : DEFAULT_STATUS };
}

export function parseAddress(input: string): { target: Target; text: string } {
  const text = input.trim();
  const match = ADDRESS.exec(text);
  if (!match) return { target: 'both', text };
  return { target: (match[1] ?? '').toLowerCase() as ExpertId, text: text.slice(match[0].length).trim() };
}

export function parseCommand(input: string): Command | null {
  const [name, ...args] = input.trim().split(/\s+/);
  if (name === '/stop' || name === '/close' || name === '/quit') return { name: name.slice(1) as 'stop' | 'close' | 'quit' };
  if (name !== '/budget') return null;
  const value = Number(args[0]);
  if (args.length !== 1 || !Number.isInteger(value) || value < 1) {
    return { name: 'invalid', reason: t().budgetUsage };
  }
  return { name: 'budget', value };
}
