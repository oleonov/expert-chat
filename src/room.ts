import { appendFile, link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from './conversation.js';
import { isLang, strings, t, type Lang } from './i18n.js';
import type { ExpertId } from './protocol.js';

export type DoneWord = 'closed' | 'quit' | 'interrupted' | 'invalid';

export interface RoomConfig {
  topic: string;
  workdir: string;
  models: { claude: string; codex: string };
  effort: string;
  lang: Lang;
}

export interface Room {
  brief: string;
  config: RoomConfig;
}

interface RoomJson {
  topic?: unknown;
  workdir?: unknown;
  effort?: unknown;
  lang?: unknown;
  models?: { claude?: unknown; codex?: unknown };
}

const DEFAULT_EFFORT = 'high';
const DEFAULT_LANG: Lang = 'en';

const roomFile = (dir: string, name: string): string => join(dir, name);

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Throws an Error whose message is the user-facing reason when the room cannot be started. */
export async function loadRoom(dir: string): Promise<Room> {
  const brief = await readFile(roomFile(dir, 'brief.md'), 'utf8').catch(() => '');
  if (brief.trim() === '') throw new Error(t().briefMissing);

  const raw = await readFile(roomFile(dir, 'room.json'), 'utf8').catch(() => undefined);
  if (raw === undefined) throw new Error(t().roomJsonMissing);
  let json: RoomJson;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(t().roomJsonInvalid);
  }

  const lang = json.lang ?? DEFAULT_LANG;
  if (!isLang(lang)) throw new Error(t().langInvalid);
  const workdir = nonEmpty(json.workdir);
  if (!workdir || !(await isDirectory(workdir))) throw new Error(t().workdirMissing);
  const claude = nonEmpty(json.models?.claude);
  const codex = nonEmpty(json.models?.codex);
  if (!claude || !codex) throw new Error(t().modelsRequired);

  const topic = nonEmpty(json.topic) ?? strings[lang].noTopic;
  const effort = nonEmpty(json.effort) ?? DEFAULT_EFFORT;
  return { brief, config: { topic, workdir, models: { claude, codex }, effort, lang } };
}

export async function appendMessage(dir: string, message: Message): Promise<void> {
  const record = {
    at: new Date().toISOString(),
    author: message.author,
    text: message.text,
    status: message.status,
    interrupted: message.interrupted,
  };
  const suffix = message.interrupted ? t().interrupted : '';
  const readable = `**[${t().authors[message.author]}]**${suffix} ${message.text}\n\n`;
  await appendFile(roomFile(dir, 'transcript.jsonl'), `${JSON.stringify(record)}\n`);
  await appendFile(roomFile(dir, 'transcript.md'), readable);
}

export async function writeDecision(dir: string, decision: string): Promise<void> {
  await writeFile(roomFile(dir, 'decision.md'), decision);
}

export async function appendLog(dir: string, expert: ExpertId, line: string): Promise<void> {
  await mkdir(roomFile(dir, 'logs'), { recursive: true });
  await appendFile(roomFile(dir, `logs/${expert}.log`), `${line}\n`);
}

let doneDrafts = 0;

/** The first `done` wins; returns false when one was already written. The reason lands before the word. */
export async function writeDone(dir: string, word: DoneWord, reason?: string): Promise<boolean> {
  const donePath = roomFile(dir, 'done');
  if (await stat(donePath).then(() => true, () => false)) return false;
  if (reason) await writeFile(roomFile(dir, 'done-reason.txt'), reason);
  // Written aside and linked in, so a waiter never reads a half-written `done`; link fails if one exists.
  const draft = roomFile(dir, `done.${process.pid}.${++doneDrafts}`);
  await writeFile(draft, word, { flag: 'wx' });
  const won = await link(draft, donePath).then(() => true, () => false);
  await rm(draft, { force: true });
  return won;
}
