import { EXPERT_IDS, type ExpertId, type ParsedReply, type Status, type Target } from './protocol.js';

export const DEFAULT_BUDGET = 8;

export type Author = 'you' | ExpertId;

export interface Message {
  id: number;
  author: Author;
  text: string;
  status?: Status;
  interrupted?: boolean;
  target?: Target;
}

export interface ExpertState {
  /** Highest message id included in this expert's latest turn input. */
  seen: number;
  busy: boolean;
  lastStatus: Status | null;
  /** Latest user message id this expert had seen when its last finished turn started. */
  lastTurnUserId: number;
  error: string | null;
  tokens: number;
  wasStopped: boolean;
}

export interface ConversationState {
  messages: Message[];
  experts: Record<ExpertId, ExpertState>;
  budget: number;
  turnsSinceUser: number;
  paused: boolean;
  lastFinisher: ExpertId | null;
}

export interface TurnInput {
  messages: Message[];
  previousInterrupted: boolean;
}

export interface TurnReply extends ParsedReply {
  interrupted?: boolean;
  tokens?: number;
}

const newExpert = (): ExpertState => ({
  seen: 0,
  busy: false,
  lastStatus: null,
  lastTurnUserId: 0,
  error: null,
  tokens: 0,
  wasStopped: false,
});

export function createConversation(budget = DEFAULT_BUDGET): ConversationState {
  return {
    messages: [],
    experts: { claude: newExpert(), gpt: newExpert() },
    budget,
    turnsSinceUser: 0,
    paused: false,
    lastFinisher: null,
  };
}

function withExpert(state: ConversationState, id: ExpertId, patch: Partial<ExpertState>): ConversationState {
  return { ...state, experts: { ...state.experts, [id]: { ...state.experts[id], ...patch } } };
}

function withMessage(state: ConversationState, message: Omit<Message, 'id'>): ConversationState {
  return { ...state, messages: [...state.messages, { ...message, id: state.messages.length + 1 }] };
}

const lastId = (state: ConversationState): number => state.messages.length;

function latestUserId(state: ConversationState): number {
  return state.messages.findLast((message) => message.author === 'you')?.id ?? 0;
}

export function addUserMessage(state: ConversationState, target: Target, text: string): ConversationState {
  const next = withMessage(state, { author: 'you', text, target });
  return { ...next, turnsSinceUser: 0, paused: false };
}

export function unseenFor(state: ConversationState, id: ExpertId): Message[] {
  return state.messages.filter((message) => message.id > state.experts[id].seen && message.author !== id);
}

export function startTurn(state: ConversationState, id: ExpertId): { state: ConversationState; input: TurnInput } {
  const input = { messages: unseenFor(state, id), previousInterrupted: state.experts[id].wasStopped };
  const next = withExpert(state, id, {
    busy: true,
    seen: lastId(state),
    lastTurnUserId: latestUserId(state),
    wasStopped: false,
  });
  return { state: next, input };
}

export function finishTurn(state: ConversationState, id: ExpertId, reply: TurnReply): ConversationState {
  const interrupted = reply.interrupted === true;
  const hasText = reply.text !== '' && reply.status !== 'pass';
  const withReply = hasText
    ? withMessage(state, { author: id, text: reply.text, status: reply.status, ...(interrupted && { interrupted }) })
    : state;
  const next = withExpert(withReply, id, {
    busy: false,
    lastStatus: interrupted ? null : reply.status,
    tokens: reply.tokens ?? state.experts[id].tokens,
    wasStopped: interrupted,
  });
  return { ...next, lastFinisher: id, turnsSinceUser: next.turnsSinceUser + (hasText ? 1 : 0) };
}

export function failExpert(state: ConversationState, id: ExpertId, error: string): ConversationState {
  return withExpert(state, id, { busy: false, error });
}

export function stop(state: ConversationState): ConversationState {
  return { ...state, paused: true };
}

export function setBudget(state: ConversationState, budget: number): ConversationState {
  return { ...state, budget };
}

export function budgetExhausted(state: ConversationState): boolean {
  return state.turnsSinceUser >= state.budget;
}

const liveExperts = (state: ConversationState): ExpertId[] =>
  EXPERT_IDS.filter((id) => state.experts[id].error === null);

/** Everyone still alive agrees (a lone survivor may also pass), based on turns that saw the latest user message. */
export function converged(state: ConversationState): boolean {
  const live = liveExperts(state);
  const accepted: Array<Status | null> = live.length === 1 ? ['agree', 'pass'] : ['agree'];
  const userId = latestUserId(state);
  return live.every((id) => {
    const expert = state.experts[id];
    return accepted.includes(expert.lastStatus) && expert.lastTurnUserId >= userId;
  });
}

function hasPendingUserMessage(state: ConversationState, id: ExpertId): boolean {
  return unseenFor(state, id).some(
    (message) => message.author === 'you' && (message.target === 'both' || message.target === id),
  );
}

export function nextTurns(state: ConversationState): ExpertId[] {
  if (state.paused) return [];
  const free = liveExperts(state).filter((id) => !state.experts[id].busy);
  const pending = free.filter((id) => hasPendingUserMessage(state, id));
  if (pending.length > 0) return pending;
  const someoneBusy = EXPERT_IDS.some((id) => state.experts[id].busy);
  if (someoneBusy || budgetExhausted(state) || converged(state)) return [];
  const candidates = free.filter((id) => unseenFor(state, id).length > 0);
  const next = candidates.length > 1 ? candidates.find((id) => id !== state.lastFinisher) : candidates[0];
  return next ? [next] : [];
}
