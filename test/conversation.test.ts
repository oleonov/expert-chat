import { describe, expect, it } from 'vitest';
import {
  addUserMessage,
  budgetExhausted,
  converged,
  createConversation,
  failExpert,
  finishTurn,
  nextTurns,
  setBudget,
  startTurn,
  stop,
  unseenFor,
  type ConversationState,
  type TurnReply,
} from '../src/conversation.js';
import type { ExpertId } from '../src/protocol.js';

const say = (text: string, status: TurnReply['status'] = 'checking'): TurnReply => ({ text, status });
const silent = (status: TurnReply['status']): TurnReply => ({ text: '', status });

function start(state: ConversationState, ...ids: ExpertId[]) {
  return ids.reduce((acc, id) => startTurn(acc, id).state, state);
}

function texts(state: ConversationState, id: ExpertId): string[] {
  return unseenFor(state, id).map((message) => message.text);
}

/** Runs scheduled turns one by one until nothing is scheduled; every turn answers with `reply`. */
function runToQuiet(initial: ConversationState, reply: (id: ExpertId, turn: number) => TurnReply): { state: ConversationState; turns: number } {
  let state = initial;
  let turns = 0;
  for (let next = nextTurns(state); next.length > 0; next = nextTurns(state)) {
    state = next.reduce((acc, id) => startTurn(acc, id).state, state);
    for (const id of next) state = finishTurn(state, id, reply(id, turns++));
    expect(turns).toBeLessThan(100);
  }
  return { state, turns };
}

describe('blind round', () => {
  it('nextTurns_unaddressedUserMessageNobodyBusy_startsBoth', () => {
    const state = addUserMessage(createConversation(), 'both', 'бриф');
    expect([...nextTurns(state)].sort()).toEqual(['claude', 'gpt']);
  });

  it('startTurn_blindRound_neitherInputContainsTheConcurrentReply', () => {
    let state = addUserMessage(createConversation(), 'both', 'бриф');
    const claude = startTurn(state, 'claude');
    const gpt = startTurn(claude.state, 'gpt');
    state = finishTurn(gpt.state, 'claude', say('ответ claude'));

    expect(gpt.input.messages.map((m) => m.text)).toEqual(['бриф']);
    expect(claude.input.messages.map((m) => m.text)).toEqual(['бриф']);
    expect(texts(state, 'gpt')).toEqual(['ответ claude']);
  });

  it('nextTurns_afterBlindRound_firstFinisherGoesFirstThenAlternate', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = finishTurn(state, 'gpt', say('gpt первым', 'disputing'));
    expect(nextTurns(state)).toEqual([]);
    state = finishTurn(state, 'claude', say('claude вторым', 'disputing'));
    expect(nextTurns(state)).toEqual(['gpt']);

    state = finishTurn(startTurn(state, 'gpt').state, 'gpt', say('gpt снова', 'disputing'));
    expect(nextTurns(state)).toEqual(['claude']);
  });

  it('nextTurns_userMessageWhileSomeoneBusy_isQueuedUntilTheyFinish', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = finishTurn(state, 'claude', say('готово', 'disputing'));
    state = addUserMessage(state, 'both', 'уточнение');
    expect(nextTurns(state)).toEqual(['claude']);

    const gptDone = finishTurn(state, 'gpt', say('готово gpt', 'disputing'));
    expect([...nextTurns(gptDone)].sort()).toEqual(['claude', 'gpt']);
    expect(texts(gptDone, 'claude')).toEqual(['уточнение', 'готово gpt']);
  });
});

describe('addressing', () => {
  it('nextTurns_addressedToClaude_runsOnlyClaudeThenOffersGpt', () => {
    let state = addUserMessage(createConversation(), 'claude', 'вопрос claude');
    expect(nextTurns(state)).toEqual(['claude']);

    state = finishTurn(startTurn(state, 'claude').state, 'claude', say('ответ', 'disputing'));
    expect(nextTurns(state)).toEqual(['gpt']);
    expect(texts(state, 'gpt')).toEqual(['вопрос claude', 'ответ']);
  });

  it('nextTurns_addressedExpertErrored_otherOneTakesTheMessage', () => {
    const state = failExpert(addUserMessage(createConversation(), 'claude', 'вопрос'), 'claude', 'лимит');
    expect(nextTurns(state)).toEqual(['gpt']);
  });
});

describe('pass and quiet', () => {
  it('finishTurn_passWithoutText_addsNoMessageAndNoBudget', () => {
    let state = addUserMessage(createConversation(), 'claude', 'вопрос');
    state = finishTurn(startTurn(state, 'claude').state, 'claude', say('ответ', 'disputing'));
    const before = state;
    state = finishTurn(startTurn(state, 'gpt').state, 'gpt', silent('pass'));

    expect(state.messages).toEqual(before.messages);
    expect(state.turnsSinceUser).toBe(1);
  });

  it('finishTurn_passWithText_addsNoMessageAndNoBudget', () => {
    let state = addUserMessage(createConversation(), 'claude', 'вопрос');
    state = finishTurn(startTurn(state, 'claude').state, 'claude', say('ответ', 'disputing'));
    const before = state;
    state = finishTurn(startTurn(state, 'gpt').state, 'gpt', say('добавить нечего', 'pass'));

    expect(state.messages).toEqual(before.messages);
    expect(state.turnsSinceUser).toBe(1);
  });

  it('nextTurns_partnerPassed_roomIsQuiet', () => {
    let state = addUserMessage(createConversation(), 'claude', 'вопрос');
    state = finishTurn(startTurn(state, 'claude').state, 'claude', say('ответ', 'disputing'));
    state = finishTurn(startTurn(state, 'gpt').state, 'gpt', silent('pass'));
    expect(nextTurns(state)).toEqual([]);
  });

  it('nextTurns_textlessAgreementAfterBlindRound_addsNothingAndRoomIsQuiet', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = finishTurn(state, 'claude', silent('agree'));
    state = finishTurn(state, 'gpt', silent('agree'));
    expect(state.messages).toHaveLength(1);
    expect(nextTurns(state)).toEqual([]);
  });
});

describe('budget', () => {
  it('nextTurns_endlessDisagreement_stopsAtEightTextTurns', () => {
    const { state, turns } = runToQuiet(addUserMessage(createConversation(), 'both', 'бриф'), () => say('спор', 'disputing'));
    expect(turns).toBe(8);
    expect(budgetExhausted(state)).toBe(true);
  });

  it('addUserMessage_afterBudgetStop_resetsCounterAndResumes', () => {
    let { state } = runToQuiet(addUserMessage(createConversation(), 'both', 'бриф'), () => say('спор', 'disputing'));
    state = addUserMessage(state, 'both', 'ещё');
    expect(state.turnsSinceUser).toBe(0);
    expect(nextTurns(state).length).toBeGreaterThan(0);
  });

  it('setBudget_twelve_allowsTwelveTurns', () => {
    const initial = setBudget(addUserMessage(createConversation(), 'both', 'бриф'), 12);
    expect(runToQuiet(initial, () => say('спор', 'disputing')).turns).toBe(12);
  });

  it('nextTurns_pendingUserMessageWithExhaustedBudget_stillSchedules', () => {
    let state = setBudget(start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt'), 1);
    state = addUserMessage(state, 'both', 'новое');
    state = finishTurn(state, 'claude', say('а', 'disputing'));
    state = finishTurn(state, 'gpt', say('б', 'disputing'));
    state = { ...state, turnsSinceUser: 5 };
    expect(budgetExhausted(state)).toBe(true);
    expect([...nextTurns(state)].sort()).toEqual(['claude', 'gpt']);
  });
});

describe('convergence', () => {
  it('converged_bothAgreeWithText_stopsEvenWithUnseenPeerMessages', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = finishTurn(state, 'claude', say('согласен, a.ts:3', 'agree'));
    state = finishTurn(state, 'gpt', say('и я, b.ts:9', 'agree'));

    expect(texts(state, 'claude')).toEqual(['и я, b.ts:9']);
    expect(converged(state)).toBe(true);
    expect(nextTurns(state)).toEqual([]);
  });

  it('converged_onlyOneAgrees_isFalse', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = finishTurn(state, 'claude', say('agree', 'agree'));
    state = finishTurn(state, 'gpt', say('нет', 'disputing'));
    expect(converged(state)).toBe(false);
    expect(nextTurns(state)).toEqual(['claude']);
  });

  it('nextTurns_userMessageTypedDuringBlindTurns_reachesBothDespiteLateAgreement', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = addUserMessage(state, 'both', 'поздняя правка');
    state = finishTurn(state, 'claude', say('agree', 'agree'));
    state = finishTurn(state, 'gpt', say('agree', 'agree'));

    expect(converged(state)).toBe(false);
    expect([...nextTurns(state)].sort()).toEqual(['claude', 'gpt']);
    expect(texts(state, 'claude')).toContain('поздняя правка');
    expect(texts(state, 'gpt')).toContain('поздняя правка');
  });

  it('converged_agreementsPredateTheLatestUserMessage_isFalseUntilNewTurns', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = finishTurn(finishTurn(state, 'claude', say('ок', 'agree')), 'gpt', say('ок', 'agree'));
    state = addUserMessage(state, 'both', 'ещё одно');
    expect(converged(state)).toBe(false);

    state = start(state, 'claude', 'gpt');
    state = finishTurn(finishTurn(state, 'claude', say('ок', 'agree')), 'gpt', say('ок', 'agree'));
    expect(converged(state)).toBe(true);
  });
});

describe('stop', () => {
  it('nextTurns_stopWithQueuedMessageWhileBothBusy_staysIdleUntilNextUserMessage', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = addUserMessage(state, 'both', 'в очереди');
    state = stop(state);
    state = finishTurn(state, 'claude', { text: 'частично', status: 'checking', interrupted: true });
    state = finishTurn(state, 'gpt', silent('checking'));
    expect(nextTurns(state)).toEqual([]);

    state = addUserMessage(state, 'both', 'продолжаем');
    expect(state.paused).toBe(false);
    expect([...nextTurns(state)].sort()).toEqual(['claude', 'gpt']);
  });

  it('finishTurn_interrupted_keepsPartialTextFlagsItAndTellsTheNextTurn', () => {
    let state = start(addUserMessage(createConversation(), 'claude', 'вопрос'), 'claude');
    state = finishTurn(state, 'claude', { text: 'обрыв', status: 'checking', interrupted: true });
    expect(state.messages.at(-1)).toMatchObject({ author: 'claude', text: 'обрыв', interrupted: true });
    expect(state.experts.claude.lastStatus).toBeNull();

    state = addUserMessage(state, 'claude', 'дальше');
    expect(startTurn(state, 'claude').input.previousInterrupted).toBe(true);
    expect(startTurn(startTurn(state, 'claude').state, 'claude').input.previousInterrupted).toBe(false);
  });
});

describe('failures', () => {
  it('nextTurns_expertFailed_chatContinuesWithTheOtherOnly', () => {
    let state = failExpert(addUserMessage(createConversation(), 'both', 'бриф'), 'gpt', 'лимит подписки');
    expect(nextTurns(state)).toEqual(['claude']);

    state = finishTurn(startTurn(state, 'claude').state, 'claude', say('ответ', 'disputing'));
    expect(nextTurns(state)).toEqual([]);
    expect(state.experts.gpt.busy).toBe(false);
  });

  it('failExpert_whileBusy_clearsBusyAndKeepsMessage', () => {
    const state = failExpert(start(addUserMessage(createConversation(), 'both', 'бриф'), 'gpt'), 'gpt', 'упал');
    expect(state.experts.gpt).toMatchObject({ busy: false, error: 'упал' });
  });

  it('converged_survivorAgreedAfterSeeingUserMessage_stopsWithUnseenErroredPeerMessage', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = finishTurn(state, 'claude', say('agree', 'agree'));
    state = finishTurn(state, 'gpt', say('нет, вот почему', 'disputing'));
    state = failExpert(state, 'gpt', 'упал');

    expect(texts(state, 'claude')).toEqual(['нет, вот почему']);
    expect(converged(state)).toBe(true);
    expect(nextTurns(state)).toEqual([]);
  });

  it('nextTurns_survivorStillDisputes_isOfferedTheUnseenMessage', () => {
    let state = start(addUserMessage(createConversation(), 'both', 'бриф'), 'claude', 'gpt');
    state = finishTurn(state, 'claude', say('нет', 'disputing'));
    state = finishTurn(state, 'gpt', say('вот факт', 'disputing'));
    state = failExpert(state, 'gpt', 'упал');
    expect(nextTurns(state)).toEqual(['claude']);
  });

  it('nextTurns_survivorPassedBeforeUserMessage_isStillOfferedNewUserInput', () => {
    let state = failExpert(addUserMessage(createConversation(), 'both', 'бриф'), 'gpt', 'упал');
    state = finishTurn(startTurn(state, 'claude').state, 'claude', silent('pass'));
    state = addUserMessage(state, 'both', 'ещё');
    expect(nextTurns(state)).toEqual(['claude']);
  });
});
