// Source-preserving visual edits on pie charts. Same invariant as
// mermaid-flowchart-edit.test.ts: after a visual edit, every source
// line the edit did not semantically touch is byte-identical, the
// result parses to exactly the intended model, and mermaid accepts it.
import { describe, it, expect } from 'vitest';
import { applyPieEdit, isValidPieValue, type PieEdit } from '../../../src/lib/editor/mermaid/pie-edit';
import { parsePie, parsePieSource, type PieModel } from '../../../src/lib/editor/mermaid/pie-parser';
import { normalizeUserText } from '../../../src/lib/editor/mermaid/display-text';
import { moveItem } from '../../../src/lib/editor/mermaid/source-text';
import { corpusBlocks, mermaidAccepts, removedLines, FUZZ_INPUTS } from './mermaid-test-utils';
import { EXTRA_CORPUS, renderSvg, shownText } from './mermaid-oracle-utils';

function edit(src: string, e: PieEdit): string {
  const r = applyPieEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

function model(src: string): PieModel {
  const r = parsePie(src);
  if (!r.ok) throw new Error(`${r.reason}\n${src}`);
  return r.model;
}

const BASIC = 'pie showData\n    title Pets adopted\n    "Dogs" : 386\n    %% cats\n    "Cats" : 85\n    "Rats" : 15\n';

describe('pie edits: targeted examples', () => {
  it('a label edit rewrites only the quoted label', () => {
    expect(edit(BASIC, { kind: 'setSliceLabel', index: 1, label: 'Kittens' })).toBe(BASIC.replace('"Cats"', '"Kittens"'));
  });

  it('a value edit rewrites only the number', () => {
    expect(edit(BASIC, { kind: 'setSliceValue', index: 0, value: 12.5 })).toBe(BASIC.replace('386', '12.5'));
    expect(edit('pie\n  "a" : 1 %% c\n', { kind: 'setSliceValue', index: 0, value: 0.0000001 })).toBe('pie\n  "a" : 0.0000001 %% c\n');
  });

  it('refuses values mermaid cannot draw', () => {
    for (const value of [0, -1, Number.NaN, Infinity]) {
      expect(isValidPieValue(value)).toBe(false);
      expect(applyPieEdit(BASIC, { kind: 'setSliceValue', index: 0, value })).toBeNull();
      expect(applyPieEdit(BASIC, { kind: 'addSlice', label: 'x', value })).toBeNull();
    }
  });

  it('labels are quoted and escaped so they read back as typed', () => {
    const out = edit(BASIC, { kind: 'setSliceLabel', index: 0, label: 'Say "hi" \\ #1 & <b>' });
    expect(out.split('\n')[2]).toBe('    "Say \\"hi\\" \\\\ #35;1 #amp; #lt;b#gt;" : 386');
    expect(model(out).slices[0].label).toBe('Say "hi" \\ #1 & <b>');
  });

  it('refuses a label another slice already has (mermaid would drop one)', () => {
    expect(applyPieEdit(BASIC, { kind: 'setSliceLabel', index: 0, label: 'Cats' })).toBeNull();
    expect(applyPieEdit(BASIC, { kind: 'addSlice', label: ' Rats ', value: 1 })).toBeNull();
    // Renaming a slice to its own label is a no-op, not a clash.
    expect(edit(BASIC, { kind: 'setSliceLabel', index: 0, label: 'Dogs' })).toBe(BASIC);
  });

  it('adds a slice after the last one (or after a given one), matching indentation', () => {
    const r = applyPieEdit(BASIC, { kind: 'addSlice', label: 'Fish', value: 3 })!;
    expect(r.index).toBe(3);
    expect(r.source).toBe(BASIC.replace('"Rats" : 15\n', '"Rats" : 15\n    "Fish" : 3\n'));
    const r2 = applyPieEdit(BASIC, { kind: 'addSlice', label: 'Fish', value: 3, afterIndex: 0 })!;
    expect(r2.index).toBe(1);
    expect(r2.source).toBe(BASIC.replace('"Dogs" : 386\n', '"Dogs" : 386\n    "Fish" : 3\n'));
    expect(edit('pie\n', { kind: 'addSlice', label: 'A', value: 1 })).toBe('pie\n    "A" : 1\n');
  });

  it('removes a slice line and nothing else', () => {
    expect(edit(BASIC, { kind: 'removeSlice', index: 1 })).toBe(BASIC.replace('    "Cats" : 85\n', ''));
  });

  it('moves a slice line, keeping comments in place', () => {
    expect(edit(BASIC, { kind: 'moveSlice', from: 2, to: 0 })).toBe(
      'pie showData\n    title Pets adopted\n    "Rats" : 15\n    "Dogs" : 386\n    %% cats\n    "Cats" : 85\n',
    );
    expect(edit(BASIC, { kind: 'moveSlice', from: 0, to: 2 })).toBe(
      'pie showData\n    title Pets adopted\n    %% cats\n    "Cats" : 85\n    "Rats" : 15\n    "Dogs" : 386\n',
    );
  });

  it('keeps a shadowed duplicate with its slice', () => {
    const src = 'pie\n  "a" : 1\n  "b" : 2\n  "a" : 3\n';
    expect(edit(src, { kind: 'setSliceLabel', index: 0, label: 'c' })).toBe('pie\n  "c" : 1\n  "b" : 2\n  "c" : 3\n');
    expect(edit(src, { kind: 'removeSlice', index: 0 })).toBe('pie\n  "b" : 2\n');
    expect(edit(src, { kind: 'moveSlice', from: 0, to: 1 })).toBe('pie\n  "b" : 2\n  "a" : 1\n  "a" : 3\n');
  });

  it('toggles showData on the header line only', () => {
    expect(edit(BASIC, { kind: 'setShowData', showData: false })).toBe(BASIC.replace('pie showData', 'pie'));
    expect(edit('pie %% c\n  "a" : 1\n', { kind: 'setShowData', showData: true })).toBe('pie showData %% c\n  "a" : 1\n');
    expect(edit(BASIC, { kind: 'setShowData', showData: true })).toBe(BASIC);
  });

  it('sets, adds and removes the title', () => {
    expect(edit(BASIC, { kind: 'setTitle', title: 'Pets' })).toBe(BASIC.replace('title Pets adopted', 'title Pets'));
    expect(edit(BASIC, { kind: 'setTitle', title: '' })).toBe(BASIC.replace('    title Pets adopted\n', ''));
    expect(edit('pie\n  "a" : 1\n', { kind: 'setTitle', title: 'New' })).toBe('pie\n  title New\n  "a" : 1\n');
    expect(edit('pie title Old %% c\n  "a" : 1\n', { kind: 'setTitle', title: 'New' })).toBe('pie title New %% c\n  "a" : 1\n');
    expect(edit('pie showData title Old\n  "a" : 1\n', { kind: 'setTitle', title: '' })).toBe('pie showData\n  "a" : 1\n');
    // A frontmatter title is edited in place while the text survives mermaid's sanitizer…
    expect(edit('---\ntitle: Old\n---\npie\n  "a" : 1\n', { kind: 'setTitle', title: 'New' })).toBe('---\ntitle: New\n---\npie\n  "a" : 1\n');
    // …and moved into the body when it would not.
    expect(edit('---\ntitle: Old\n---\npie\n  "a" : 1\n', { kind: 'setTitle', title: 'A & B' })).toBe('pie\n  title A #amp; B\n  "a" : 1\n');
  });

  it('keeps CRLF line endings', () => {
    const src = 'pie\r\n  "a" : 1\r\n  "b" : 2\r\n';
    expect(edit(src, { kind: 'removeSlice', index: 0 })).toBe('pie\r\n  "b" : 2\r\n');
    expect(edit(src, { kind: 'addSlice', label: 'c', value: 3 })).toBe('pie\r\n  "a" : 1\r\n  "b" : 2\r\n  "c" : 3\r\n');
  });

  it('refuses edits naming a missing slice or an unreadable source', () => {
    expect(applyPieEdit(BASIC, { kind: 'removeSlice', index: 9 })).toBeNull();
    expect(applyPieEdit(BASIC, { kind: 'moveSlice', from: 0, to: 9 })).toBeNull();
    expect(applyPieEdit('pie\n  oops\n', { kind: 'setTitle', title: 'x' })).toBeNull();
  });
});

// ── Property test over the corpus ────────────────────────────────────

const TRICKY = 'Renamed "q" \\ #59; %% & <b> : x';
const NORMAL_TRICKY = normalizeUserText(TRICKY);

interface Op {
  name: string;
  edit: PieEdit;
  expected: (m: PieModel) => PieModel;
  // Which original lines the op may rewrite or drop.
  touches: (line: number) => boolean;
  // A move: these original lines are relocated, every other line keeps
  // its text and relative order.
  relocates?: number[];
}

function opsFor(src: string): Op[] {
  const parsed = parsePieSource(src);
  if (!parsed.ok) throw new Error(parsed.reason);
  const { model: m, map } = parsed;
  const ops: Op[] = [];
  const titleLines = new Set(map.titles.map((t) => t.line));
  const fm = map.lines[0]?.trim() === '---' ? map.lines.indexOf('---', 1) : -1;
  const inFrontmatter = (l: number) => fm > 0 && l <= fm;
  const sliceLines = (i: number) => new Set([map.slices[i].line, ...map.slices[i].duplicates]);

  // setTitle touches title statements and the frontmatter title key.
  const titleTouch = (l: number) => titleLines.has(l) || inFrontmatter(l);
  ops.push({ name: 'set title', edit: { kind: 'setTitle', title: TRICKY }, expected: (x) => ({ ...x, title: NORMAL_TRICKY }), touches: titleTouch });
  ops.push({ name: 'clear title', edit: { kind: 'setTitle', title: '' }, expected: (x) => ({ ...x, title: '' }), touches: titleTouch });
  // showData touches the header line only.
  ops.push({
    name: 'toggle showData',
    edit: { kind: 'setShowData', showData: !m.showData },
    expected: (x) => ({ ...x, showData: !m.showData }),
    touches: (l) => l === map.headerLine,
  });
  m.slices.forEach((_, i) => {
    const own = sliceLines(i);
    const label = `${TRICKY} ${i}`;
    ops.push({
      name: `label ${i}`,
      edit: { kind: 'setSliceLabel', index: i, label },
      expected: (x) => ({ ...x, slices: x.slices.map((s, k) => (k === i ? { ...s, label: normalizeUserText(label) } : s)) }),
      touches: (l) => own.has(l),
    });
    ops.push({
      name: `value ${i}`,
      edit: { kind: 'setSliceValue', index: i, value: 7.25 },
      expected: (x) => ({ ...x, slices: x.slices.map((s, k) => (k === i ? { ...s, value: 7.25 } : s)) }),
      touches: (l) => l === map.slices[i].line,
    });
    ops.push({
      name: `remove ${i}`,
      edit: { kind: 'removeSlice', index: i },
      expected: (x) => ({ ...x, slices: x.slices.filter((_, k) => k !== i) }),
      touches: (l) => own.has(l),
    });
    for (const to of [0, m.slices.length - 1]) {
      if (to === i) continue;
      ops.push({
        name: `move ${i}→${to}`,
        edit: { kind: 'moveSlice', from: i, to },
        expected: (x) => ({ ...x, slices: moveItem(x.slices, i, to) }),
        // Only the moved slice's own lines are relocated.
        touches: () => false,
        relocates: [...own],
      });
    }
    ops.push({
      name: `add after ${i}`,
      edit: { kind: 'addSlice', label: 'Added', value: 3, afterIndex: i },
      expected: (x) => ({ ...x, slices: [...x.slices.slice(0, i + 1), { label: 'Added', value: 3 }, ...x.slices.slice(i + 1)] }),
      touches: () => false,
    });
  });
  ops.push({
    name: 'add at end',
    edit: { kind: 'addSlice', label: TRICKY, value: 1 },
    expected: (x) => ({ ...x, slices: [...x.slices, { label: NORMAL_TRICKY, value: 1 }] }),
    touches: () => false,
  });
  return ops;
}

const isPie = (b: { source: string }) => /^\s*pie\b/m.test(b.source) && parsePie(b.source).ok;
const blocks = corpusBlocks(isPie, ['mermaid-corpus.md', EXTRA_CORPUS]);

describe('pie edits: corpus property', () => {
  it('finds editable pies in the corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(5);
  });

  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const before = model(block.source);
      const lines = block.source.split('\n');
      for (const op of opsFor(block.source)) {
        const res = applyPieEdit(block.source, op.edit);
        expect(res, op.name).not.toBeNull();
        const out = res!.source;
        // (a) exactly the intended model change
        expect(model(out), `${op.name}:\n${out}`).toEqual(op.expected(before));
        // (b) every removed line is one the op touches; a move keeps
        // everything but the moved lines in place
        if (op.relocates) {
          const moved = new Set(op.relocates.map((l) => lines[l]));
          const rest = (s: string) => s.split('\n').filter((l) => !moved.has(l));
          expect(rest(out), op.name).toEqual(rest(block.source));
          expect(out.split('\n').length, op.name).toBe(lines.length);
        }
        const removed = op.relocates ? [] : removedLines(block.source, out);
        const allowed = new Map<string, number>();
        lines.forEach((l, i) => op.touches(i) && allowed.set(l, (allowed.get(l) ?? 0) + 1));
        for (const l of removed) {
          const n = allowed.get(l) ?? 0;
          expect(n > 0, `${op.name} changed an unrelated line ${JSON.stringify(l)}:\n${out}`).toBe(true);
          allowed.set(l, n - 1);
        }
        // (c) mermaid accepts it
        expect(await mermaidAccepts(out), `${op.name}:\n${out}`).toBe(true);
      }
    }, 60_000);
  }
});

// ── Fuzz: typed text reads back — and is drawn — exactly as typed ────

describe('pie edits: fuzz over typed text', () => {
  const SRC = 'pie showData\n    title Old\n    "One" : 1\n    "Two" : 2\n';
  for (const input of FUZZ_INPUTS) {
    it(`title / label ${JSON.stringify(input)}`, async () => {
      const shown = normalizeUserText(input);
      const titled = edit(SRC, { kind: 'setTitle', title: input });
      expect(await mermaidAccepts(titled), titled).toBe(true);
      expect(model(titled).title).toBe(shown);
      let svg = await renderSvg(titled);
      expect(shownText(svg.querySelector('.pieTitleText')), titled).toBe(shown);

      const labelled = edit(SRC, { kind: 'setSliceLabel', index: 1, label: input });
      expect(await mermaidAccepts(labelled), labelled).toBe(true);
      expect(model(labelled).slices[1].label).toBe(shown);
      svg = await renderSvg(labelled);
      expect(shownText(svg.querySelectorAll('g.legend text')[1]), labelled).toBe(`${shown} [2]`.trim());

      const added = applyPieEdit(SRC, { kind: 'addSlice', label: input, value: 5 })!;
      expect(await mermaidAccepts(added.source), added.source).toBe(true);
      expect(model(added.source).slices[added.index!].label).toBe(shown);
    });
  }
});
