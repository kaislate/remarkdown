import { describe, it, expect } from 'vitest';
import {
  parseRich,
  serializeRich,
  hasFormatting,
  richToPlain,
  runsToHtml,
  htmlToRuns,
} from '../../../src/lib/editor/mermaid/rich-text';

describe('rich text (bold / italic labels)', () => {
  it('reads the markdown mermaid accepts in markdown strings', () => {
    expect(parseRich('**Bold** and _italic_')).toEqual([
      { text: 'Bold', bold: true, italic: false },
      { text: ' and ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);
    expect(parseRich('*it* __b__ ***both***')).toEqual([
      { text: 'it', bold: false, italic: true },
      { text: ' ', bold: false, italic: false },
      { text: 'b', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'both', bold: true, italic: true },
    ]);
    expect(parseRich('Line one\nLine two')).toEqual([{ text: 'Line one\nLine two', bold: false, italic: false }]);
    // A lone marker is text.
    expect(parseRich('2 * 3')).toEqual([{ text: '2 * 3', bold: false, italic: false }]);
    expect(parseRich('a \\*b\\*')).toEqual([{ text: 'a *b*', bold: false, italic: false }]);
  });

  it('writes runs back as minimal markdown, escaping literal markers', () => {
    expect(serializeRich([
      { text: 'Bold', bold: true, italic: false },
      { text: ' plain ', bold: false, italic: false },
      { text: 'it', bold: false, italic: true },
    ])).toBe('**Bold** plain *it*');
    expect(serializeRich([{ text: 'a*b_c', bold: false, italic: false }])).toBe('a\\*b\\_c');
    // Adjacent runs with the same format merge.
    expect(serializeRich([
      { text: 'a', bold: true, italic: false },
      { text: 'b', bold: true, italic: false },
    ])).toBe('**ab**');
    expect(serializeRich([{ text: 'x', bold: true, italic: true }])).toBe('***x***');
  });

  it('round-trips', () => {
    for (const md of ['**Bold** label', 'a *b* c', '***x*** y', 'Line one\nLine two', 'plain']) {
      expect(serializeRich(parseRich(md))).toBe(md);
    }
  });

  it('formatting / plain helpers', () => {
    expect(hasFormatting(parseRich('plain'))).toBe(false);
    expect(hasFormatting(parseRich('**b**'))).toBe(true);
    expect(richToPlain(parseRich('**Bold** _it_'))).toBe('Bold it');
  });

  it('HTML for the editable field and back', () => {
    const runs = parseRich('**B** <x> & *i*\nnext');
    const html = runsToHtml(runs);
    expect(html).toBe('<b>B</b> &lt;x&gt; &amp; <i>i</i><br>next');
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(htmlToRuns(div)).toEqual(runs);
    // What contenteditable produces in practice: <strong>, <em>,
    // <div> lines, nested spans, a trailing <br>.
    div.innerHTML = '<strong>Hi</strong> <span><em>there</em></span><div>second</div><br>';
    expect(serializeRich(htmlToRuns(div))).toBe('**Hi** *there*\nsecond');
  });
});
