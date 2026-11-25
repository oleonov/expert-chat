import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n.js';
import { ClaudeExpert, ClaudeParser } from '../src/experts/claude.js';
import { CodexExpert, CodexParser } from '../src/experts/codex.js';
import { CliExpert, runProcess, type CliCommand } from '../src/experts/process.js';
import type { ExpertOptions, StatusEvent, TurnParser } from '../src/experts/types.js';
import { renderTurnInput } from '../src/prompts.js';
import { appendLog, appendMessage, loadRoom, writeDecision, writeDone } from '../src/room.js';

beforeAll(() => setLang('ru'));

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

async function events(name: string): Promise<unknown[]> {
  const raw = await readFile(fixture(name), 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function feed(parser: TurnParser, items: unknown[]): string[] {
  return items.flatMap((item) => parser.consume(item)).map((event) => `${event.kind}:${event.text}`);
}

const options: ExpertOptions = { model: 'm1', effort: 'high', workdir: '/work', rules: 'RULES' };

describe('ClaudeParser', () => {
  it('consume_readFixture_mapsToolUseAndTextToStatuses', async () => {
    const statuses = feed(new ClaudeParser(), await events('claude-stream.jsonl'));
    expect(statuses).toEqual(['status:читает hosts', 'status:пишет']);
  });

  it('consume_readFixture_returnsFinalTextSessionAndTokens', async () => {
    const parser = new ClaudeParser();
    feed(parser, await events('claude-stream.jsonl'));
    expect(parser.sessionId).toBe('921fc7de-01fc-4752-b7d0-2ea261277510');
    expect(parser.text).toMatch(/^Файл `\/etc\/hosts` прочитан.*\[\[status: agree\]\]$/s);
    expect(parser.tokens).toBe(4 + 9863 + 9591 + 143);
    expect(parser.error).toBeUndefined();
  });

  it('consume_partialFixtureCutBeforeResult_keepsStreamedTextForAnInterruptedTurn', async () => {
    const all = await events('claude-partial.jsonl');
    const beforeResult = all.slice(0, all.findIndex((e) => (e as { type: string }).type === 'result'));
    const parser = new ClaudeParser();
    const statuses = feed(parser, beforeResult.filter((e) => (e as { type: string }).type === 'stream_event'));

    expect(statuses).toEqual(['status:думает', 'status:пишет']);
    expect(parser.text).toBe(
      'Вы не указали, с каким утверждением спорите, поэтому пока не могу ответить по существу. Напишите, что именно оспариваете, и я проверю это по фактам.\n[[status: disputing]]',
    );
    expect(parser.sessionId).toBe('70c0ecd2-2e33-47f3-8cf9-9b1a87ea086c');
  });

  it('consume_partialMessageStart_dropsTextOfThePreviousMessage', () => {
    const parser = new ClaudeParser();
    const delta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
    feed(parser, [delta('вступление'), { type: 'stream_event', event: { type: 'message_start' } }, delta('итог')]);
    expect(parser.text).toBe('итог');
  });

  it.each([
    ['Grep', 'status:ищет в коде'],
    ['Glob', 'status:ищет в коде'],
    ['WebSearch', 'status:ищет в сети'],
    ['WebFetch', 'status:открывает страницу'],
  ])('consume_%sToolUse_mapsToStatus', (name, expected) => {
    const message = { type: 'assistant', message: { content: [{ type: 'tool_use', name, input: {} }] } };
    expect(feed(new ClaudeParser(), [message])).toEqual([expected]);
  });

  it('consume_rateLimitRejected_setsSubscriptionLimitError', () => {
    const parser = new ClaudeParser();
    feed(parser, [{ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }]);
    expect(parser.error).toBe('лимит подписки');
  });

  it('consume_rateLimitWarning_isANoteOnly', () => {
    const parser = new ClaudeParser();
    const out = feed(parser, [{ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } }]);
    expect(out).toEqual(['note:лимит близко']);
    expect(parser.error).toBeUndefined();
  });

  it('consume_resultIsError_setsErrorFromResultText', () => {
    const parser = new ClaudeParser();
    feed(parser, [{ type: 'result', is_error: true, subtype: 'error_during_execution', result: 'Credit balance is too low' }]);
    expect(parser.error).toBe('Credit balance is too low');
  });
});

describe('CodexParser', () => {
  it('consume_execFixture_mapsItemsToStatuses', async () => {
    const statuses = feed(new CodexParser(), await events('codex-exec.jsonl'));
    expect(statuses).toEqual([
      'status:пишет',
      'status:команда',
      'status:ищет в сети',
      'status:ищет в сети',
      'status:пишет',
    ]);
  });

  it('consume_execFixture_lastAgentMessageWinsAndTokensAndThreadAreRead', async () => {
    const parser = new CodexParser();
    feed(parser, await events('codex-exec.jsonl'));
    expect(parser.text).toMatch(/^Ink renders React components.*\[\[status: disputing\]\]$/s);
    expect(parser.sessionId).toBe('01a2110d-2c4b-7012-aac1-6c7030113efc');
    expect(parser.tokens).toBe(77671 + 111);
    expect(parser.error).toBeUndefined();
  });

  it('consume_agentMessageStarted_doesNotReplaceTheFinalText', () => {
    const parser = new CodexParser();
    feed(parser, [
      { type: 'item.completed', item: { type: 'agent_message', text: 'готово' } },
      { type: 'item.started', item: { type: 'agent_message', text: '' } },
    ]);
    expect(parser.text).toBe('готово');
  });

  it('consume_reasoningItem_mapsToThinking', () => {
    expect(feed(new CodexParser(), [{ type: 'item.started', item: { type: 'reasoning' } }])).toEqual(['status:думает']);
  });

  it('consume_turnFailed_setsError', () => {
    const parser = new CodexParser();
    feed(parser, [{ type: 'turn.failed', error: { message: 'usage limit reached' } }]);
    expect(parser.error).toBe('usage limit reached');
  });

  it('consume_errorEventFollowedByCompletedTurn_isNotAnError', () => {
    const parser = new CodexParser();
    feed(parser, [{ type: 'error', message: 'Reconnecting... 1/5' }, { type: 'turn.completed', usage: {} }]);
    expect(parser.error).toBeUndefined();
  });

  it('consume_errorEventWithoutCompletedTurn_isAnError', () => {
    const parser = new CodexParser();
    feed(parser, [{ type: 'error', message: 'stream disconnected' }]);
    expect(parser.error).toBe('stream disconnected');
  });
});

describe('command lines', () => {
  it('command_claudeFirstTurn_isReadOnlyWithoutBashMcpOrUserSettings', () => {
    const { command, args, stdin } = new ClaudeExpert(options).command('вопрос', undefined);
    expect(command).toBe('claude');
    expect(stdin).toBe('вопрос');
    expect(args).toEqual([
      '-p', '--model', 'm1', '--effort', 'high', '--permission-mode', 'default', '--strict-mcp-config',
      '--setting-sources', 'project,local',
      '--settings', '{"disableAllHooks":true}',
      '--tools', 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch',
      '--allowedTools', 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch',
      '--append-system-prompt', 'RULES',
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    ]);
  });

  it('command_claudeLaterTurn_resumesTheSession', () => {
    const { args } = new ClaudeExpert(options).command('ещё', 'sid-1');
    expect(args.slice(0, 3)).toEqual(['-p', '--resume', 'sid-1']);
  });

  it('command_codexFirstTurn_putsRulesInPromptAndUsesSandboxConfig', () => {
    const { command, args, stdin } = new CodexExpert(options).command('вопрос', undefined);
    expect(command).toBe('codex');
    expect(stdin).toBe('RULES\n\nвопрос');
    expect(args).toEqual([
      '--search', 'exec', '-C', '/work',
      '-m', 'm1', '-c', 'model_reasoning_effort=high', '-c', 'sandbox_mode="read-only"',
      '--ignore-user-config', '--disable', 'apps', '--disable', 'browser_use',
      '--disable', 'browser_use_external', '--disable', 'computer_use',
      '--skip-git-repo-check', '--json', '-',
    ]);
  });

  it('command_codexResume_keepsIsolationAndNeverPassesSandboxFlag', () => {
    const { args, stdin } = new CodexExpert({ ...options, effort: 'low' }).command('ещё', 'thread-1');
    expect(stdin).toBe('ещё');
    expect(args.slice(0, 4)).toEqual(['--search', 'exec', 'resume', 'thread-1']);
    expect(args).toContain('model_reasoning_effort=low');
    expect(args).toContain('--ignore-user-config');
    expect(args).not.toContain('-s');
    expect(args).not.toContain('-C');
  });
});

describe('runProcess', () => {
  const cwd = tmpdir();

  it('runProcess_stdinPrompt_emitsEveryStdoutLineAndStderrTail', async () => {
    const lines: string[] = [];
    const script = "process.stdin.on('data', d => process.stdout.write(d)); process.stdin.on('end', () => { console.error('warn1'); console.error('warn2'); });";
    const running = runProcess({ command: 'node', args: ['-e', script], cwd, stdin: 'a\nb\nlast', onLine: (l) => lines.push(l) });
    const exit = await running.done;
    expect(lines).toEqual(['a', 'b', 'last']);
    expect(exit.code).toBe(0);
    expect(exit.stderrTail).toBe('warn1\nwarn2\n');
  });

  it('runProcess_missingBinary_resolvesWithErrorInStderrTail', async () => {
    const exit = await runProcess({ command: 'definitely-not-a-cli', args: [], cwd, stdin: '', onLine: () => {} }).done;
    expect(exit.code).not.toBe(0);
    expect(exit.stderrTail).toContain('ENOENT');
  });

  it('done_leaderExitsLeavingADescendant_killsTheDescendant', async () => {
    const lines: string[] = [];
    const script = '(trap "" TERM; sleep 30) >/dev/null 2>&1 </dev/null & echo $!';
    await runProcess({ command: 'sh', args: ['-c', script], cwd, stdin: '', onLine: (line) => lines.push(line) }).done;
    const descendant = Number(lines[0]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => process.kill(descendant, 0)).toThrow();
  });

  it('done_descendantHoldsTheOutputPipe_settlesWhenTheLeaderExits', async () => {
    const running = runProcess({ command: 'sh', args: ['-c', 'sleep 30 & exit 0'], cwd, stdin: '', onLine: () => {} });
    const started = Date.now();
    await running.done;
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('kill_backgroundChild_endsTheWholeProcessGroup', async () => {
    const running = runProcess({ command: 'sh', args: ['-c', 'sleep 30 & wait'], cwd, stdin: '', onLine: () => {} });
    const started = Date.now();
    setTimeout(() => running.kill(), 100);
    await running.done;
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

class ScriptedExpert extends CliExpert {
  inputs: string[] = [];

  constructor(public cli: CliCommand, private readonly parser: () => TurnParser) {
    super({ ...options, workdir: tmpdir() });
  }

  command(input: string): CliCommand {
    this.inputs.push(input);
    return this.cli;
  }

  protected createParser(): TurnParser {
    return this.parser();
  }
}

const catFixture = (name: string): CliCommand => ({ command: 'cat', args: [fixture(name)], stdin: '' });

describe('CliExpert.runTurn', () => {
  it('runTurn_claudeFixture_returnsParsedReplyAndForwardsStatuses', async () => {
    const seen: StatusEvent[] = [];
    const expert = new ScriptedExpert(catFixture('claude-stream.jsonl'), () => new ClaudeParser());
    const result = await expert.runTurn('вопрос', (event) => seen.push(event));
    expect(result).toMatchObject({ status: 'agree', interrupted: false, tokens: 19601 });
    expect(result.text).toMatch(/^Файл `\/etc\/hosts` прочитан/);
    expect(result.text).not.toContain('[[status');
    expect(seen.map((e) => e.text)).toEqual(['читает hosts', 'пишет']);
  });

  it('runTurn_codexFixture_returnsLastAgentMessage', async () => {
    const expert = new ScriptedExpert(catFixture('codex-exec.jsonl'), () => new CodexParser());
    const result = await expert.runTurn('вопрос', () => {});
    expect(result).toMatchObject({ status: 'disputing', interrupted: false });
    expect(result.text).toMatch(/^Ink renders React components.*github\.com\/vadimdemedes\/ink\)$/s);
  });

  it('runTurn_afterATurnStoppedBeforeTheSessionOpened_resendsItsInput', async () => {
    const expert = new ScriptedExpert({ command: 'sleep', args: ['30'], stdin: '' }, () => new ClaudeParser());
    const stopped = expert.runTurn('BRIEF', () => {});
    setTimeout(() => expert.stop(), 50);
    expect(await stopped).toMatchObject({ interrupted: true });
    expert.cli = catFixture('claude-stream.jsonl');
    await expert.runTurn('NEXT', () => {});
    await expert.runTurn('THIRD', () => {});
    expect(expert.inputs).toEqual(['BRIEF', 'BRIEF\n\nNEXT', 'THIRD']);
  });

  it('runTurn_nonZeroExit_rejectsWithStderrTail', async () => {
    const cli = { command: 'sh', args: ['-c', 'echo boom >&2; exit 3'], stdin: '' };
    const expert = new ScriptedExpert(cli, () => new CodexParser());
    await expect(expert.runTurn('x', () => {})).rejects.toThrow(/код выхода 3: boom/);
  });

  it('runTurn_parserError_rejectsWithThatError', async () => {
    const cli = { command: 'sh', args: ['-c', `echo '{"type":"turn.failed","error":{"message":"usage limit"}}'`], stdin: '' };
    const expert = new ScriptedExpert(cli, () => new CodexParser());
    await expect(expert.runTurn('x', () => {})).rejects.toThrow('usage limit');
  });

  it('runTurn_exitsWithoutAnyReply_rejects', async () => {
    const expert = new ScriptedExpert({ command: 'true', args: [], stdin: '' }, () => new CodexParser());
    await expect(expert.runTurn('x', () => {})).rejects.toThrow('пустой ответ');
  });

  it('stop_runningTurn_resolvesInterruptedWithPartialText', async () => {
    const script = `echo '{"type":"item.completed","item":{"type":"agent_message","text":"часть"}}'; sleep 30`;
    const expert = new ScriptedExpert({ command: 'sh', args: ['-c', script], stdin: '' }, () => new CodexParser());
    const turn = expert.runTurn('x', (event) => {
      if (event.text === 'пишет') expert.stop();
    });
    await expect(turn).resolves.toMatchObject({ text: 'часть', interrupted: true });
  });
});

describe('room', () => {
  let dir: string;
  let workdir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'room-'));
    workdir = await mkdtemp(join(tmpdir(), 'work-'));
    await writeFile(join(dir, 'brief.md'), 'Задача');
    await writeFile(join(dir, 'room.json'), JSON.stringify({ topic: 'T', workdir, models: { claude: 'c', codex: 'x' } }));
  });

  it('loadRoom_validRoom_defaultsEffortToHigh', async () => {
    const room = await loadRoom(dir);
    expect(room.brief).toBe('Задача');
    expect(room.config).toEqual({ topic: 'T', workdir, models: { claude: 'c', codex: 'x' }, effort: 'high', lang: 'en' });
  });

  it('loadRoom_langInRoomJson_isUsed', async () => {
    await writeFile(join(dir, 'room.json'), JSON.stringify({ workdir, models: { claude: 'c', codex: 'x' }, lang: 'ru' }));
    expect((await loadRoom(dir)).config.lang).toBe('ru');
  });

  it('loadRoom_invalidLang_throwsReadableReason', async () => {
    await writeFile(join(dir, 'room.json'), JSON.stringify({ workdir, models: { claude: 'c', codex: 'x' }, lang: 'de' }));
    await expect(loadRoom(dir)).rejects.toThrow(/lang/);
  });

  it('loadRoom_effortInRoomJson_isUsed', async () => {
    await writeFile(join(dir, 'room.json'), JSON.stringify({ workdir, models: { claude: 'c', codex: 'x' }, effort: 'low' }));
    expect((await loadRoom(dir)).config.effort).toBe('low');
  });

  it.each([
    ['empty brief', 'brief.md', '  \n', /brief\.md/],
    ['broken json', 'room.json', '{oops', /JSON/],
    ['missing workdir dir', 'room.json', JSON.stringify({ workdir: '/no/such/dir', models: { claude: 'c', codex: 'x' } }), /workdir/],
    ['empty codex model', 'room.json', JSON.stringify({ workdir: tmpdir(), models: { claude: 'c', codex: ' ' } }), /models/],
  ])('loadRoom_%s_throwsReadableReason', async (_name, file, content, reason) => {
    await writeFile(join(dir, file), content);
    await expect(loadRoom(dir)).rejects.toThrow(reason);
  });

  it('appendMessage_twoMessages_appendsToJsonlAndMarkdown', async () => {
    await appendMessage(dir, { id: 1, author: 'you', text: 'привет' });
    await appendMessage(dir, { id: 2, author: 'gpt', text: 'обрыв', status: 'disputing', interrupted: true });
    const lines = (await readFile(join(dir, 'transcript.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toMatchObject([{ author: 'you', text: 'привет' }, { author: 'gpt', status: 'disputing', interrupted: true }]);
    expect(typeof lines[0].at).toBe('string');
    expect(await readFile(join(dir, 'transcript.md'), 'utf8')).toBe('**[Ты]** привет\n\n**[GPT]** (прервано) обрыв\n\n');
  });

  it('writeDone_concurrentCalls_publishOneCompleteWord', async () => {
    const results = await Promise.all([writeDone(dir, 'closed'), writeDone(dir, 'interrupted')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await readFile(join(dir, 'done'), 'utf8')).toBe(results[0] ? 'closed' : 'interrupted');
    expect((await readdir(dir)).filter((name) => name.startsWith('done.'))).toEqual([]);
  });

  it('writeDone_secondCall_keepsTheFirstWord', async () => {
    expect(await writeDone(dir, 'invalid', 'нет брифа')).toBe(true);
    expect(await writeDone(dir, 'interrupted')).toBe(false);
    expect(await readFile(join(dir, 'done'), 'utf8')).toBe('invalid');
    expect(await readFile(join(dir, 'done-reason.txt'), 'utf8')).toBe('нет брифа');
  });

  it('writeDecisionAndAppendLog_writeFilesUnderTheRoom', async () => {
    await writeDecision(dir, 'Вопрос: …');
    await appendLog(dir, 'claude', 'raw1');
    await appendLog(dir, 'claude', 'raw2');
    expect(await readFile(join(dir, 'decision.md'), 'utf8')).toBe('Вопрос: …');
    expect(await readFile(join(dir, 'logs', 'claude.log'), 'utf8')).toBe('raw1\nraw2\n');
  });
});

describe('renderTurnInput', () => {
  it('renderTurnInput_messagesAndInterruption_labelsAuthorsAndEndsWithMarkerReminder', () => {
    const text = renderTurnInput({
      previousInterrupted: true,
      messages: [
        { id: 1, author: 'you', text: 'вопрос' },
        { id: 2, author: 'claude', text: 'обрыв', interrupted: true },
        { id: 3, author: 'gpt', text: 'ответ' },
      ],
    });
    expect(text).toContain('[Ты] вопрос');
    expect(text).toContain('[Claude] обрыв (прервано пользователем)');
    expect(text).toContain('[GPT] ответ');
    expect(text).toContain('остановил пользователь');
    expect(text.trimEnd().endsWith('[[status: checking|disputing|agree|pass]].')).toBe(true);
  });
});
