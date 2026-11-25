import { basename } from 'node:path';
import { t } from '../i18n.js';
import { CliExpert, type CliCommand } from './process.js';
import type { StatusEvent, TurnParser } from './types.js';

const TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'];

interface ContentBlock {
  type?: string;
  name?: string;
  input?: { file_path?: string };
}

interface ClaudeEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  usage?: Record<string, number>;
  rate_limit_info?: { status?: string };
  event?: { type?: string; content_block?: ContentBlock; delta?: { type?: string; text?: string } };
  message?: { content?: ContentBlock[] };
}

const status = (text: string): StatusEvent => ({ kind: 'status', text });

function toolStatus(name: string | undefined, input: ContentBlock['input']): string {
  switch (name) {
    case 'Read':
      return input?.file_path ? t().reading(basename(input.file_path)) : t().readingFile;
    case 'Grep':
    case 'Glob':
      return t().searchingCode;
    case 'WebSearch':
      return t().searchingWeb;
    case 'WebFetch':
      return t().openingPage;
    default:
      return t().working;
  }
}

function blockStatus(block: ContentBlock): StatusEvent[] {
  switch (block.type) {
    case 'thinking':
      return [status(t().thinking)];
    case 'text':
      return [status(t().writing)];
    case 'tool_use':
      return [status(toolStatus(block.name, block.input))];
    default:
      return [];
  }
}

function totalTokens(usage: Record<string, number> | undefined): number {
  const keys = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];
  return keys.reduce((sum, key) => sum + (usage?.[key] ?? 0), 0);
}

export class ClaudeParser implements TurnParser {
  sessionId: string | undefined;
  tokens = 0;
  error: string | undefined;
  private finalText: string | undefined;
  private partialText = '';

  get text(): string {
    return this.finalText ?? this.partialText;
  }

  consume(raw: unknown): StatusEvent[] {
    const event = raw as ClaudeEvent;
    this.sessionId = event.session_id ?? this.sessionId;
    switch (event.type) {
      case 'assistant':
        return (event.message?.content ?? []).flatMap(blockStatus);
      case 'stream_event':
        return this.consumeStream(event.event);
      case 'rate_limit_event':
        return this.consumeRateLimit(event.rate_limit_info?.status);
      case 'result':
        this.consumeResult(event);
        return [];
      default:
        return [];
    }
  }

  private consumeStream(stream: ClaudeEvent['event']): StatusEvent[] {
    if (stream?.type === 'message_start') this.partialText = '';
    if (stream?.type === 'content_block_delta' && stream.delta?.type === 'text_delta') {
      this.partialText += stream.delta.text ?? '';
    }
    return stream?.type === 'content_block_start' && stream.content_block ? blockStatus(stream.content_block) : [];
  }

  private consumeRateLimit(limitStatus: string | undefined): StatusEvent[] {
    if (limitStatus === 'rejected') this.error = t().subscriptionLimit;
    return limitStatus === 'allowed_warning' ? [{ kind: 'note', text: t().limitNear }] : [];
  }

  private consumeResult(event: ClaudeEvent): void {
    this.tokens = totalTokens(event.usage);
    this.finalText = event.result ?? '';
    if (event.is_error) this.error ??= event.result || event.subtype || t().claudeFailed;
  }
}

export class ClaudeExpert extends CliExpert {
  command(input: string, sessionId: string | undefined): CliCommand {
    const { model, effort, rules } = this.options;
    const args = [
      '-p',
      ...(sessionId ? ['--resume', sessionId] : []),
      '--model', model,
      '--effort', effort,
      '--permission-mode', 'default',
      '--strict-mcp-config',
      // The user's own settings (language, hooks, global CLAUDE.md) stay out; project instructions stay in.
      '--setting-sources', 'project,local',
      // A project's own hooks run as shell commands, which a read-only expert must not do.
      '--settings', '{"disableAllHooks":true}',
      '--tools', ...TOOLS,
      '--allowedTools', ...TOOLS,
      '--append-system-prompt', rules,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];
    return { command: 'claude', args, stdin: input };
  }

  protected createParser(): TurnParser {
    return new ClaudeParser();
  }
}
