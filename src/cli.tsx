#!/usr/bin/env node
import { resolve } from 'node:path';
import { render } from 'ink';
import { ClaudeExpert } from './experts/claude.js';
import { CodexExpert } from './experts/codex.js';
import { setLang, t } from './i18n.js';
import type { ExpertId } from './protocol.js';
import { appendLog, loadRoom, writeDone } from './room.js';
import { App } from './ui/App.js';

/** Raw CLI logs are a debugging aid; a failed write must not take the chat down. */
const ignore = (): void => undefined;

async function main(): Promise<void> {
  const roomDir = resolve(process.argv[2] ?? '');
  if (process.argv[2] === undefined) {
    console.error('usage: expert-chat <roomDir>');
    process.exit(2);
  }
  const room = await loadRoom(roomDir).catch(async (error: Error) => {
    console.error(error.message);
    await writeDone(roomDir, 'invalid', error.message);
    return process.exit(1);
  });

  const { models, effort, workdir, lang } = room.config;
  setLang(lang);
  const common = { effort, workdir, rules: t().systemRules };
  const log = (id: ExpertId) => (line: string) => void appendLog(roomDir, id, line).catch(ignore);
  const experts = {
    claude: new ClaudeExpert({ ...common, model: models.claude, log: log('claude') }),
    gpt: new CodexExpert({ ...common, model: models.codex, log: log('gpt') }),
  };

  await render(<App roomDir={roomDir} room={room} experts={experts} />, { exitOnCtrlC: false }).waitUntilExit();
  // Only if the app ended without publishing its own word; the first `done` wins.
  experts.claude.stop();
  experts.gpt.stop();
  await writeDone(roomDir, 'interrupted');
  process.exit(0);
}

void main();
