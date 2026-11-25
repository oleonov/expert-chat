import { t } from '../i18n.js';
import { CliExpert, type CliCommand } from './process.js';
import type { StatusEvent, TurnParser } from './types.js';

const ISOLATION = [
  '--ignore-user-config',
  '--disable', 'apps',
  '--disable', 'browser_use',
  '--disable', 'browser_use_external',
  '--disable', 'computer_use',
];

interface CodexItem {
  type?: string;
  text?: string;
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
  message?: string;
}

const status = (text: string): StatusEvent => ({ kind: 'status', text });

export class CodexParser implements TurnParser {
  sessionId: string | undefined;
  tokens = 0;
  error: string | undefined;
  private lastMessage = '';

  get text(): string {
    return this.lastMessage;
  }

  consume(raw: unknown): StatusEvent[] {
    const event = raw as CodexEvent;
    switch (event.type) {
      case 'thread.started':
        this.sessionId = event.thread_id;
        return [];
      case 'item.started':
      case 'item.completed':
        return this.consumeItem(event.type, event.item);
      case 'turn.completed':
        // A retried stream emits `error` events before a turn that still completes.
        this.error = undefined;
        this.tokens = (event.usage?.input_tokens ?? 0) + (event.usage?.output_tokens ?? 0);
        return [];
      case 'turn.failed':
        this.error = event.error?.message || t().codexFailed;
        return [];
      case 'error':
        this.error = event.message || t().codexFailed;
        return [];
      default:
        return [];
    }
  }

  private consumeItem(eventType: string, item: CodexItem | undefined): StatusEvent[] {
    switch (item?.type) {
      case 'reasoning':
        return [status(t().thinking)];
      case 'command_execution':
        return eventType === 'item.started' ? [status(t().command)] : [];
      case 'web_search':
        return [status(t().searchingWeb)];
      case 'agent_message':
        if (eventType === 'item.completed') this.lastMessage = item.text ?? '';
        return [status(t().writing)];
      default:
        return [];
    }
  }
}

export class CodexExpert extends CliExpert {
  command(input: string, sessionId: string | undefined): CliCommand {
    const { model, effort, workdir, rules } = this.options;
    const common = [
      '-m', model,
      '-c', `model_reasoning_effort=${effort}`,
      '-c', 'sandbox_mode="read-only"',
      ...ISOLATION,
      '--skip-git-repo-check',
      '--json',
      '-',
    ];
    const args = sessionId
      ? ['--search', 'exec', 'resume', sessionId, ...common]
      : ['--search', 'exec', '-C', workdir, ...common];
    return { command: 'codex', args, stdin: sessionId ? input : `${rules}\n\n${input}` };
  }

  protected createParser(): TurnParser {
    return new CodexParser();
  }
}
