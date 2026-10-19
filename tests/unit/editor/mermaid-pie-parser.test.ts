import { describe, it, expect } from 'vitest';
import { parsePie, parsePieSource, PIE_STARTER } from '../../../src/lib/editor/mermaid/pie-parser';
import { corpusBlocks, mermaidAccepts } from './mermaid-test-utils';
import { EXTRA_CORPUS, oracleDb, oracleText, renderSvg, shownText } from './mermaid-oracle-utils';

function model(src: string) {
  const r = parsePie(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

describe('pie parser', () => {
  it('reads the corpus pie', () => {
    expect(model('pie showData\n    title Pets adopted\n    "Dogs" : 386\n    "Cats" : 85\n    "Rats" : 15\n')).toEqual({
      title: 'Pets adopted',
      showData: true,
      slices: [
        { label: 'Dogs', value: 386 },
        { label: 'Cats', value: 85 },
        { label: 'Rats', value: 15 },
      ],
    });
  });

  it('reads titles the way mermaid shows them', () => {
    // Stops at %%, collapses spaces; the last title wins; frontmatter loses to a body title.
    expect(model('pie\n  title  Pets   adopted %% note\n  "a" : 1\n').title).toBe('Pets adopted');
    expect(model('pie\n  title First\n  title Second\n').title).toBe('Second');
    expect(model('---\ntitle: From yaml\n---\npie\n  "a" : 1\n').title).toBe('From yaml');
    expect(model('---\ntitle: From yaml\n---\npie\n  title Body\n').title).toBe('Body');
    expect(model('pie title Inline\n  "a" : 1\n').title).toBe('Inline');
    expect(model('pie showData title Inline %% c\n  "a" : 1\n')).toMatchObject({ title: 'Inline', showData: true });
    expect(model('pie\n  title\n  "a" : 1\n').title).toBe('');
    expect(model('pie\n  title Tom #amp; Jerry #59;\n').title).toBe('Tom & Jerry ;');
  });

  it('reads labels: quotes, escapes, entity codes, whitespace', () => {
    const m = model('pie\n  "a \\"q\\" \\\\ b" : 1\n  \'single\' : 2.5\n  "  sp  aced  " : 3\n  "x #59; y" : 4\n  "" : 5\n');
    expect(m.slices).toEqual([
      { label: 'a "q" \\ b', value: 1 },
      { label: 'single', value: 2.5 },
      { label: 'sp aced', value: 3 },
      { label: 'x ; y', value: 4 },
      { label: '', value: 5 },
    ]);
  });

  it('keeps only the first slice of a label, like mermaid', () => {
    const r = parsePieSource('pie\n  "a" : 1\n  "b" : 2\n  "a" : 3\n');
    expect(r.ok && r.model.slices).toEqual([{ label: 'a', value: 1 }, { label: 'b', value: 2 }]);
    expect(r.ok && r.map.slices[0].duplicates).toEqual([3]);
  });

  it('skips comments, directives, accessibility statements and blank lines', () => {
    const src = [
      '%%{init: {"theme": "forest"}}%%',
      '%% leading comment',
      'pie',
      '',
      '  accTitle: Pets',
      '  accDescr: A pie of pets',
      '  accDescr {',
      '    multi',
      '    line }',
      '  %% inline comment',
      '  "a" : 1 %% trailing',
      '  "b":2',
    ].join('\n');
    expect(model(src).slices).toEqual([{ label: 'a', value: 1 }, { label: 'b', value: 2 }]);
  });

  it('records where each part sits', () => {
    const r = parsePieSource('pie showData\n  title T\n  "a" : 1\n');
    if (!r.ok) throw new Error(r.reason);
    expect(r.map.headerLine).toBe(0);
    expect(r.map.showData).toEqual({ start: 3, end: 12 });
    expect(r.map.titles).toEqual([{ line: 1, value: { start: 8, end: 9 }, cut: null }]);
    expect(r.map.slices).toEqual([{ line: 2, label: { start: 2, end: 5 }, value: { start: 8, end: 9 }, duplicates: [] }]);
  });

  it('refuses what it cannot read', () => {
    expect(parsePie('flowchart LR\n  A --> B\n').ok).toBe(false);
    expect(parsePie('').ok).toBe(false);
    expect(parsePie('pie\n  "a" : -1\n').ok).toBe(false);
    expect(parsePie('pie\n  "a" : 01\n').ok).toBe(false);
    expect(parsePie('pie\n  a : 1\n').ok).toBe(false);
    expect(parsePie('pie "a" : 1\n').ok).toBe(false);
  });

  it('the starter is a valid, editable pie', async () => {
    expect(await mermaidAccepts(PIE_STARTER)).toBe(true);
    expect(model(PIE_STARTER).slices.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Oracle: our model == mermaid's own parse ─────────────────────────

const isPie = (b: { source: string }) => /^\s*pie\b/m.test(b.source) && parsePie(b.source).ok;
const blocks = corpusBlocks(isPie, ['mermaid-corpus.md', EXTRA_CORPUS]);

describe('pie parser: oracle over the corpus', () => {
  it('has pie blocks', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(5);
  });

  for (const b of blocks) {
    it(`${b.heading}: matches mermaid's db`, async () => {
      const m = model(b.source);
      const { db, title } = await oracleDb(b.source);
      expect(m.title).toBe(title);
      expect(m.showData).toBe(db.getShowData());
      const sections: Array<[string, number]> = [...db.getSections().entries()];
      expect(m.slices).toEqual(sections.map(([label, value]) => ({ label: oracleText(label), value })));
    });

    it(`${b.heading}: matches what mermaid draws`, async () => {
      const m = model(b.source);
      const svg = await renderSvg(b.source);
      expect(shownText(svg.querySelector('.pieTitleText'))).toBe(m.title);
      const legend = Array.from(svg.querySelectorAll('g.legend text')).map(shownText);
      expect(legend).toEqual(m.slices.map((s) => (m.showData ? `${s.label} [${s.value}]` : s.label)));
    });
  }
});
