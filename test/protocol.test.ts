import { beforeAll, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n.js';
import { parseAddress, parseCommand, parseReply } from '../src/protocol.js';

beforeAll(() => setLang('ru'));

describe('parseReply', () => {
  it('parseReply_ownLabelPrefix_isStripped', () => {
    expect(parseReply('[Claude] Проверил: 49 строк.\n[[status: agree]]')).toEqual({ text: 'Проверил: 49 строк.', status: 'agree' });
  });

  it('parseReply_markerOnLastLine_stripsMarkerAndKeepsStatus', () => {
    expect(parseReply('Нашёл в a.ts:3.\n[[status: disputing]]')).toEqual({ text: 'Нашёл в a.ts:3.', status: 'disputing' });
  });

  it('parseReply_noMarker_defaultsToChecking', () => {
    expect(parseReply('просто текст')).toEqual({ text: 'просто текст', status: 'checking' });
  });

  it('parseReply_unknownMarker_defaultsToCheckingAndStripsIt', () => {
    expect(parseReply('текст\n[[status: ура]]')).toEqual({ text: 'текст', status: 'checking' });
  });

  it('parseReply_onlyMarker_returnsEmptyText', () => {
    expect(parseReply('[[status: pass]]')).toEqual({ text: '', status: 'pass' });
  });

  it('parseReply_englishTokens_mapToStatuses', () => {
    expect(parseReply('ok\n[[status: agree]]').status).toBe('agree');
    expect(parseReply('no\n[[status: DISPUTING]]').status).toBe('disputing');
    expect(parseReply('[[status: pass]]')).toEqual({ text: '', status: 'pass' });
  });

  it('parseReply_russianWordInMarker_defaultsToChecking', () => {
    expect(parseReply('ок\n[[status: согласен]]').status).toBe('checking');
  });

  it('parseReply_markerInTheMiddle_isKeptInText', () => {
    const raw = '[[status: pass]] дальше ещё текст';
    expect(parseReply(raw)).toEqual({ text: raw, status: 'checking' });
  });

  it('parseReply_markerWithTrailingWhitespace_isRecognised', () => {
    expect(parseReply('ок\n[[status: agree]]  \n')).toEqual({ text: 'ок', status: 'agree' });
  });
});

describe('parseAddress', () => {
  it('parseAddress_noPrefix_targetsBoth', () => {
    expect(parseAddress('  привет всем ')).toEqual({ target: 'both', text: 'привет всем' });
  });

  it('parseAddress_claudePrefixAnyCase_targetsClaude', () => {
    expect(parseAddress('@Claude проверь a.ts')).toEqual({ target: 'claude', text: 'проверь a.ts' });
  });

  it('parseAddress_gptPrefix_targetsGpt', () => {
    expect(parseAddress('@gpt?')).toEqual({ target: 'both', text: '@gpt?' });
    expect(parseAddress('@GPT')).toEqual({ target: 'gpt', text: '' });
  });

  it('parseAddress_longerHandle_isNotAnAddress', () => {
    expect(parseAddress('@claudex hi')).toEqual({ target: 'both', text: '@claudex hi' });
  });

  it('parseAddress_mentionNotAtStart_targetsBoth', () => {
    expect(parseAddress('спроси @gpt')).toEqual({ target: 'both', text: 'спроси @gpt' });
  });
});

describe('parseCommand', () => {
  it('parseCommand_simpleCommands_areRecognised', () => {
    expect(parseCommand('/stop')).toEqual({ name: 'stop' });
    expect(parseCommand(' /close ')).toEqual({ name: 'close' });
    expect(parseCommand('/quit')).toEqual({ name: 'quit' });
  });

  it('parseCommand_budgetWithNumber_returnsValue', () => {
    expect(parseCommand('/budget 12')).toEqual({ name: 'budget', value: 12 });
  });

  it.each(['/budget', '/budget abc', '/budget 0', '/budget 2.5', '/budget 3 4'])(
    'parseCommand_badBudget_isInvalid (%s)',
    (input) => {
      expect(parseCommand(input)?.name).toBe('invalid');
    },
  );

  it('parseCommand_plainTextOrUnknownSlash_isNotACommand', () => {
    expect(parseCommand('привет')).toBeNull();
    expect(parseCommand('/etc/hosts странный')).toBeNull();
  });
});
