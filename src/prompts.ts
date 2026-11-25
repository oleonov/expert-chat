import type { Message, TurnInput } from './conversation.js';
import { t } from './i18n.js';

function renderMessage(message: Message): string {
  const suffix = message.interrupted ? t().interruptedByUser : '';
  return `[${t().authors[message.author]}] ${message.text}${suffix}`;
}

/** `task` closes the input: the status reminder in chat, a closing instruction in the /close flow. */
export function renderTurnInput(input: TurnInput, task = t().statusReminder): string {
  const stopped = input.previousInterrupted ? [t().previousTurnStopped] : [];
  return [...input.messages.map(renderMessage), ...stopped, task].join('\n\n');
}
