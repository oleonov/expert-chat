import type { Author } from './conversation.js';
import type { Status } from './protocol.js';

export type Lang = 'en' | 'ru';

export const LANGS: readonly Lang[] = ['en', 'ru'];

export const isLang = (value: unknown): value is Lang => LANGS.some((lang) => lang === value);

export interface Strings {
  authors: Record<Author, string>;
  statusLabels: Record<Status, string>;

  // Expert-facing prompts
  statusReminder: string;
  systemRules: string;
  verifiedHeading: string;
  objectionsStrip: RegExp;
  objectionsBy: (author: string) => string;
  interruptedByUser: string;
  previousTurnStopped: string;
  draftPrompt: string;
  objectionsPrompt: (draft: string) => string;
  revisionPrompt: (draft: string) => string;

  // Room files
  interrupted: string;
  transcriptLine: (path: string) => string;
  noDecision: string;
  noTopic: string;
  briefMissing: string;
  roomJsonMissing: string;
  roomJsonInvalid: string;
  workdirMissing: string;
  modelsRequired: string;
  langInvalid: string;

  // Protocol
  budgetUsage: string;

  // Expert activity and failures
  thinking: string;
  writing: string;
  command: string;
  reading: (file: string) => string;
  readingFile: string;
  searchingCode: string;
  searchingWeb: string;
  openingPage: string;
  working: string;
  subscriptionLimit: string;
  limitNear: string;
  claudeFailed: string;
  codexFailed: string;
  exitCode: (code: number | null, lastLine: string) => string;
  emptyReply: string;

  // UI
  chatHint: string;
  draftHint: string;
  closingHint: string;
  draftTitle: string;
  expertsTitle: (topic: string) => string;
  transcriptWriteFailed: (reason: string) => string;
  waiting: string;
  errorWord: string;
  contextWord: string;
  turns: (used: number, max: number) => string;
  paused: string;
  converged: string;
  yourTurn: string;
}

const STATUS_REMINDER_MARKER = '[[status: checking|disputing|agree|pass]]';

const enVerified = 'Verified in code';
const enForm = `Question: …
Decision: …
Agreed: …
Disputed: … (whose position, verified or not)
${enVerified}: file:line → what held up
Open: …`;

const ruVerified = 'Проверено в коде';
const ruForm = `Вопрос: …
Решение: …
Сошлись: …
Спорное: … (чья позиция, проверено или нет)
${ruVerified}: file:line → что подтвердилось
Открыто: …`;

const enReminder = `Last line of the reply: ${STATUS_REMINDER_MARKER}.`;
const ruReminder = `Последняя строка ответа: ${STATUS_REMINDER_MARKER}.`;

const en: Strings = {
  authors: { you: 'You', claude: 'Claude', gpt: 'GPT' },
  statusLabels: { checking: 'checking', disputing: 'disputing', agree: 'agrees', pass: 'passed' },

  statusReminder: enReminder,
  systemRules: `You are a participant in a group chat: the user and two experts, Claude and GPT, working through one task.
Messages arrive labelled [You] (the user), [Claude], [GPT].
- You are read-only: you may read and search project files, search the web and open pages. Change nothing.
- A colleague's claim is a hypothesis. Agree only after checking it yourself, and cite file:line or a URL. Replying "agree" without checking is forbidden.
- Keep replies short, chat-style: no polite openers, no retelling what was already said.
- If you have nothing to add, reply with just the pass marker.
- Reply in English.
- ${enReminder}
  checking — still verifying or stating facts; disputing — you disagree; agree — you checked and agree; pass — nothing to add.`,
  verifiedHeading: enVerified,
  objectionsStrip: /^\s*objections\s*:?\s*/i,
  objectionsBy: (author) => `Objections from ${author}:`,
  interruptedByUser: ' (interrupted by the user)',
  previousTurnStopped: '(Your previous turn was stopped by the user with /stop.)',
  draftPrompt: `The user is closing the chat. Write the summary draft in exactly this form, without a "Transcript" line (the app adds it):\n${enForm}\nNo status marker needed.`,
  objectionsPrompt: (draft) =>
    `Here is the chat summary draft. Check it and list objections: what is wrong, unverified or missing. If you have none, reply with just the [[status: pass]] marker.\n\n${draft}`,
  revisionPrompt: (draft) =>
    `The user's last message asks to amend the summary draft. Apply it and return the whole draft in the same form, without a "Transcript" line. No status marker needed.\n\nDraft:\n${draft}`,

  interrupted: ' (interrupted)',
  transcriptLine: (path) => `Transcript: ${path}`,
  noDecision: 'Decision: not produced (both experts dropped out)',
  noTopic: 'no topic',
  briefMissing: 'brief.md is missing or empty',
  roomJsonMissing: 'room.json is missing',
  roomJsonInvalid: 'room.json is not valid JSON',
  workdirMissing: 'room.json: workdir does not exist',
  modelsRequired: 'room.json: models.claude and models.codex are required',
  langInvalid: 'room.json: lang must be "en" or "ru"',

  budgetUsage: '/budget N — a whole number above zero',

  thinking: 'thinking',
  writing: 'writing',
  command: 'running a command',
  reading: (file) => `reading ${file}`,
  readingFile: 'reading a file',
  searchingCode: 'searching code',
  searchingWeb: 'searching the web',
  openingPage: 'opening a page',
  working: 'working',
  subscriptionLimit: 'subscription limit',
  limitNear: 'limit is near',
  claudeFailed: 'Claude error',
  codexFailed: 'Codex error',
  exitCode: (code, lastLine) => `exit code ${code ?? 'none'}: ${lastLine}`,
  emptyReply: 'empty reply',

  chatHint: '/stop /close /quit /budget N',
  draftHint: 'Enter — accept · text — edit · /stop — back to chat · /quit',
  closingHint: 'The summary is still being written; send this once it is shown, or /stop to go back to the chat',
  draftTitle: 'Summary draft',
  expertsTitle: (topic) => `Experts: ${topic}`,
  transcriptWriteFailed: (reason) => `Could not write to the transcript: ${reason}`,
  waiting: 'waiting',
  errorWord: 'error',
  contextWord: 'context',
  turns: (used, max) => `turns ${used} of ${max}`,
  paused: 'paused',
  converged: 'in agreement',
  yourTurn: 'your turn',
};

const ru: Strings = {
  authors: { you: 'Ты', claude: 'Claude', gpt: 'GPT' },
  statusLabels: { checking: 'проверяю', disputing: 'спорю', agree: 'согласен', pass: 'пас' },

  statusReminder: ruReminder,
  systemRules: `Ты участник группового чата: пользователь и два эксперта, Claude и GPT, разбирают одну задачу.
Реплики приходят с метками [Ты] (пользователь), [Claude], [GPT].
- Ты только читаешь: можешь читать и искать файлы проекта, искать в сети и открывать страницы. Ничего не меняй.
- Утверждение собеседника — гипотеза. Соглашайся только после собственной проверки и укажи file:line или URL. Отвечать agree без проверки запрещено.
- Пиши коротко, как в чате, без вежливых вступлений и пересказа сказанного.
- Если добавить нечего, ответь только маркером pass.
- Отвечай по-русски.
- ${ruReminder} Слова в маркере только английские, ровно эти.
  checking — ещё проверяешь или излагаешь факты; disputing — не согласен; agree — проверил и согласен; pass — добавить нечего.`,
  verifiedHeading: ruVerified,
  objectionsStrip: /^\s*возражения\s*:?\s*/i,
  objectionsBy: (author) => `Возражения ${author}:`,
  interruptedByUser: ' (прервано пользователем)',
  previousTurnStopped: '(Твой прошлый ход остановил пользователь командой /stop.)',
  draftPrompt: `Пользователь закрывает чат. Напиши черновик итога строго в этой форме, без строки «Переписка» (её добавит приложение):\n${ruForm}\nМаркер статуса не нужен.`,
  objectionsPrompt: (draft) =>
    `Вот черновик итога чата. Проверь его и перечисли возражения: что неверно, не проверено или пропущено. Если возражений нет, ответь только маркером [[status: pass]].\n\n${draft}`,
  revisionPrompt: (draft) =>
    `Последнее сообщение пользователя — правка черновика итога. Внеси её и верни черновик целиком в той же форме, без строки «Переписка». Маркер статуса не нужен.\n\nЧерновик:\n${draft}`,

  interrupted: ' (прервано)',
  transcriptLine: (path) => `Переписка: ${path}`,
  noDecision: 'Решение: не сформировано (оба эксперта выбыли)',
  noTopic: 'без темы',
  briefMissing: 'brief.md отсутствует или пуст',
  roomJsonMissing: 'room.json отсутствует',
  roomJsonInvalid: 'room.json не разобрался как JSON',
  workdirMissing: 'room.json: workdir не существует',
  modelsRequired: 'room.json: нужны models.claude и models.codex',
  langInvalid: 'room.json: lang должен быть "en" или "ru"',

  budgetUsage: '/budget N — целое число больше нуля',

  thinking: 'думает',
  writing: 'пишет',
  command: 'команда',
  reading: (file) => `читает ${file}`,
  readingFile: 'читает файл',
  searchingCode: 'ищет в коде',
  searchingWeb: 'ищет в сети',
  openingPage: 'открывает страницу',
  working: 'работает',
  subscriptionLimit: 'лимит подписки',
  limitNear: 'лимит близко',
  claudeFailed: 'ошибка Claude',
  codexFailed: 'ошибка Codex',
  exitCode: (code, lastLine) => `код выхода ${code ?? 'нет'}: ${lastLine}`,
  emptyReply: 'пустой ответ',

  chatHint: '/stop /close /quit /budget N',
  draftHint: 'Enter — принять · текст — правка · /stop — назад в чат · /quit',
  closingHint: 'Итог ещё пишется: отправьте это, когда он появится, или /stop, чтобы вернуться в чат',
  draftTitle: 'Черновик итога',
  expertsTitle: (topic) => `Эксперты: ${topic}`,
  transcriptWriteFailed: (reason) => `Не записалось в переписку: ${reason}`,
  waiting: 'ждёт',
  errorWord: 'ошибка',
  contextWord: 'контекст',
  turns: (used, max) => `ходов ${used} из ${max}`,
  paused: 'пауза',
  converged: 'сошлись',
  yourTurn: 'жду тебя',
};

export const strings: Record<Lang, Strings> = { en, ru };

let current: Strings = en;

/** One room per process: the language is chosen once at startup. */
export function setLang(lang: Lang): void {
  current = strings[lang];
}

export const t = (): Strings => current;
