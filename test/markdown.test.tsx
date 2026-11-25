import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/ui/Markdown.js';

const frame = (text: string) => render(<Markdown text={text} />).lastFrame() ?? '';

describe('Markdown', () => {
  it('render_inlineMarkup_dropsTheMarkers', () => {
    const out = frame('**Yes.** See `main.h:476` and [main.cpp](/abs/main.cpp).');
    expect(out).toBe('Yes. See main.h:476 and main.cpp.');
  });

  it('render_webLink_keepsItsAddress', () => {
    expect(frame('See [docs](https://example.com/a).')).toBe('See docs (https://example.com/a).');
  });

  it('render_headingsAndBullets_showTextWithBulletMarks', () => {
    expect(frame('## Fix\n- first\n  * nested')).toBe('Fix\n• first\n  • nested');
    expect(frame('## **Decision**')).toBe('Decision');
  });

  it('render_fencedCode_dropsTheFencesAndKeepsMarkupLiteral', () => {
    expect(frame('Code:\n```cpp\nint **p = `x`;\n```\nDone')).toBe('Code:\n  int **p = `x`;\nDone');
  });

  it('render_codeInsideBold_dropsBothMarkers', () => {
    expect(frame('**`main.h`:** add it')).toBe('main.h: add it');
    expect(frame('**`int *p`** here')).toBe('int *p here');
  });

  it('render_blankLine_keepsParagraphsApart', () => {
    expect(frame('one\n\ntwo')).toBe('one\n\ntwo');
  });

  it('render_unpairedMarkers_stayAsTyped', () => {
    expect(frame('2 ** 63 and a ` tick')).toBe('2 ** 63 and a ` tick');
  });
});
