// The editor's serializer renders each top-level block on its own and keeps
// the result per block (unchanged blocks keep their Node), so saving a big
// document after an edit only renders the block that changed. Its output
// must be byte-for-byte what prosemirror-markdown's whole-document pass
// writes, which serializeWholeDocForTests still does.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import {
  serializeDocToMarkdown,
  serializeWholeDocForTests,
  serializerWork,
} from '../../../src/lib/editor/serializer';
import { editorSchema } from '../../../src/lib/editor/schema';

const ROOT = resolve(__dirname, '../../..');

function readMd(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

// Markdown the e2e specs open: every quoted string with a line break in it.
function e2eDocs(): string[] {
  const dir = resolve(ROOT, 'tests/e2e');
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.spec.ts'))) {
    const src = readFileSync(resolve(dir, f), 'utf8');
    const literals = [
      ...src.matchAll(/'(?:[^'\\\n]|\\.)*\\n(?:[^'\\\n]|\\.)*'/g),
      ...src.matchAll(/`(?:[^`\\$]|\\.)*\n(?:[^`\\$]|\\.)*`/g),
    ];
    for (const m of literals) {
      try {
        const value = new Function(`return ${m[0]};`)() as unknown;
        if (typeof value === 'string' && value.trim()) out.push(value);
      } catch {
        // not a plain literal
      }
    }
  }
  return out;
}

function corpus(): Array<[string, string]> {
  const docs: Array<[string, string]> = [];
  const fixtures = resolve(ROOT, 'tests/fixtures');
  for (const f of readdirSync(fixtures).filter((n) => n.endsWith('.md'))) {
    docs.push([`fixtures/${f}`, readMd(resolve(fixtures, f))]);
  }
  for (const f of ['examples/welcome.md', 'README.md', 'CHANGELOG.md', 'RELEASING.md']) {
    docs.push([f, readMd(resolve(ROOT, f))]);
  }
  e2eDocs().forEach((md, i) => docs.push([`e2e#${i}`, md]));
  return docs;
}

const p = (text = '') => editorSchema.node('paragraph', null, text ? [editorSchema.text(text)] : []);
const li = (text: string, checked: boolean | null = null) =>
  editorSchema.node('list_item', { checked }, [p(text)]);
const ul = (...items: string[]) => editorSchema.node('bullet_list', { tight: true }, items.map((t) => li(t)));
const looseUl = (...items: string[]) => editorSchema.node('bullet_list', { tight: false }, items.map((t) => li(t)));
const ol = (...items: string[]) => editorSchema.node('ordered_list', { tight: true }, items.map((t) => li(t)));
const math = (tex: string) => editorSchema.node('math_block', { tex });
const h = (text: string) => editorSchema.node('heading', { level: 2 }, [editorSchema.text(text)]);
const doc = (...blocks: Node[]) => editorSchema.node('doc', null, blocks);

// Small deterministic PRNG so a failure reproduces.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// One random edit: typing, a new paragraph, a deletion, or an empty line.
function randomEdit(state: EditorState, rand: () => number): EditorState {
  const size = state.doc.content.size;
  const pos = Math.floor(rand() * size);
  const kind = rand();
  try {
    const sel = TextSelection.near(state.doc.resolve(pos));
    let tr = state.tr.setSelection(sel);
    if (kind < 0.45) {
      tr = tr.insertText(['x', ' ', '*', '[', '!', '1. ', '- ', '#'][Math.floor(rand() * 8)]);
    } else if (kind < 0.6) {
      if (!sel.$from.parent.isTextblock || sel.$from.parent.type.spec.code) return state;
      tr = tr.split(sel.from);
    } else if (kind < 0.85) {
      const to = Math.min(size, pos + 1 + Math.floor(rand() * 12));
      tr = tr.delete(pos, to);
    } else {
      const $pos = state.doc.resolve(pos);
      const at = $pos.depth > 0 ? $pos.before(1) : 0;
      tr = tr.insert(at, p());
    }
    return state.apply(tr);
  } catch {
    return state;
  }
}

describe('per-block serializer: same bytes as the whole-document pass', () => {
  it('writes every fixture, example and e2e document exactly as before', () => {
    const docs = corpus();
    expect(docs.length).toBeGreaterThan(40);
    const fallbacks = serializerWork.fallbacks;
    for (const [name, md] of docs) {
      const d = parseMarkdownToDoc(md);
      expect(serializeDocToMarkdown(d), name).toBe(serializeWholeDocForTests(d));
    }
    // Every one of them went through the per-block path.
    expect(serializerWork.fallbacks).toBe(fallbacks);
  });

  it('stays identical through random edits (the per-block memo is reused)', () => {
    for (const [name, md] of corpus()) {
      let state = EditorState.create({ doc: parseMarkdownToDoc(md), schema: editorSchema });
      const rand = rng(name.length * 7919 + md.length);
      for (let i = 0; i < 12; i++) {
        state = randomEdit(state, rand);
        expect(serializeDocToMarkdown(state.doc), `${name} after edit ${i}`).toBe(
          serializeWholeDocForTests(state.doc),
        );
      }
    }
  });

  it('handles the joins that depend on the block before', () => {
    const cases: Array<[string, Node]> = [
      ['two bullet lists in a row', doc(ul('a', 'b'), ul('c'))],
      ['two loose bullet lists in a row', doc(looseUl('a', 'b'), looseUl('c'))],
      ['two ordered lists in a row', doc(ol('a'), ol('b', 'c'))],
      ['bullet then ordered', doc(ul('a'), ol('b'))],
      ['lists split by an empty line', doc(ul('a'), p(), ul('b'))],
      ['lists split by an empty formula', doc(ul('a'), math(''), ul('b'))],
      ['empty formula first', doc(math(''), p('a'))],
      ['empty line first', doc(p(), p('a'))],
      ['only empty lines', doc(p(), p(), p())],
      ['empty line last', doc(p('a'), p())],
      ['a heading after a list', doc(ul('a'), h('b'), ol('c'), ol('d'))],
      ['a task list after a task list', doc(
        editorSchema.node('bullet_list', { tight: true }, [li('x', true)]),
        editorSchema.node('bullet_list', { tight: true }, [li('y', false)]),
      )],
      ['an image paragraph after a link-ish paragraph', doc(p('see!'), p('[x](y)'))],
    ];
    const fallbacks = serializerWork.fallbacks;
    for (const [name, d] of cases) {
      expect(serializeDocToMarkdown(d), name).toBe(serializeWholeDocForTests(d));
    }
    expect(serializerWork.fallbacks).toBe(fallbacks);
  });
});

describe('per-block serializer: work done', () => {
  function bigDoc(blocks: number): string {
    const parts: string[] = [];
    for (let i = 0; i < blocks; i++) {
      switch (i % 6) {
        case 0: parts.push(`## Section ${i}`); break;
        case 1: parts.push(`Paragraph ${i} with **bold**, *italic*, \`code\` and a [link](https://example.com/${i}).`); break;
        case 2: parts.push(`- item ${i}\n- item ${i + 1}\n  - nested ${i}`); break;
        case 3: parts.push('```ts\nconst x = ' + i + ';\nconsole.log(x);\n```'); break;
        case 4: parts.push(`> [!note]\n> Callout ${i} body.`); break;
        default: parts.push(`| a | b |\n| --- | --- |\n| ${i} | ${i + 1} |`);
      }
    }
    return parts.join('\n\n') + '\n';
  }

  it('after one edit renders only the block that changed', () => {
    const md = bigDoc(3000);
    let state = EditorState.create({ doc: parseMarkdownToDoc(md), schema: editorSchema });
    serializeDocToMarkdown(state.doc);
    // Type a character in the middle of the document.
    const mid = Math.floor(state.doc.content.size / 2);
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(mid))).insertText('z'));
    const before = serializerWork.blocksRendered;
    const out = serializeDocToMarkdown(state.doc);
    expect(serializerWork.blocksRendered - before).toBe(1);
    expect(out).toBe(serializeWholeDocForTests(state.doc));
  });

  it('takes linear time on a large document (timings reported, work counted)', () => {
    const md = bigDoc(4500); // ~190 KB (the whole-doc pass is the slow part)
    const d = parseMarkdownToDoc(md);
    const t0 = performance.now();
    const whole = serializeWholeDocForTests(d);
    const t1 = performance.now();
    const before = serializerWork.blocksRendered;
    const cold = serializeDocToMarkdown(d);
    const t2 = performance.now();
    const warm = serializeDocToMarkdown(d);
    const t3 = performance.now();
    expect(cold).toBe(whole);
    expect(warm).toBe(whole);
    // Each top-level block rendered once, and not again for the warm pass.
    expect(serializerWork.blocksRendered - before).toBe(d.childCount);
    console.log(
      `[perf F16] ${(md.length / 1024).toFixed(0)} KB, ${d.childCount} blocks: whole-doc ${(t1 - t0).toFixed(0)} ms, ` +
      `per-block cold ${(t2 - t1).toFixed(0)} ms, warm ${(t3 - t2).toFixed(1)} ms`,
    );
  });
});

// A changelog or an outline is often one long list: a single top-level
// block. prosemirror-markdown looks at the tail of its output with regexes
// that scan the whole output (before every line, and before every link), so
// one block of 300 KB took seconds to write, on every save, Done and tab
// switch. Each block is now written with its output kept short.
describe('per-block serializer: one very large block', () => {
  function bigList(items: number): string {
    const out: string[] = [];
    for (let i = 0; i < items; i++) {
      out.push(`- item ${i} with **bold** words and a [link](https://example.com/${i}) here`);
      if (i % 7 === 0) out.push(`  - nested ${i}! [after a bang](https://example.com/n${i})`);
      // A literal backslash, a bang, then a link: only the last two
      // characters written decide whether the bang gets escaped.
      if (i % 3 === 0) out.push(`  - tail ${'x'.repeat(i % 29)}\\\\\\![l${i}](u${i})`);
      if (i % 11 === 0) out.push(`  1. ordered ${i}\\![not an image](x)`);
      if (i % 13 === 0) out.push(`  > quoted ${i}\n  > second line`);
      if (i % 17 === 0) out.push('  ```js\n  const v = ' + i + ';\n  ```');
    }
    return out.join('\n') + '\n';
  }

  it('writes a big list exactly as the whole-document pass does', () => {
    const md = bigList(600);
    let state = EditorState.create({ doc: parseMarkdownToDoc(md), schema: editorSchema });
    expect(state.doc.childCount).toBe(1);
    expect(serializeDocToMarkdown(state.doc)).toBe(serializeWholeDocForTests(state.doc));
    const rand = rng(4242);
    for (let i = 0; i < 4; i++) {
      state = randomEdit(state, rand);
      expect(serializeDocToMarkdown(state.doc), `after edit ${i}`).toBe(serializeWholeDocForTests(state.doc));
    }
    // A quote holding a long list, and one long paragraph full of links.
    const quoted = parseMarkdownToDoc(md.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n'));
    expect(serializeDocToMarkdown(quoted)).toBe(serializeWholeDocForTests(quoted));
    const para = parseMarkdownToDoc(
      Array.from({ length: 800 }, (_, i) => `word${i}! [l${i}](u${i}) **b** w${'y'.repeat(i % 31)}\\\\\\![m](v)`).join(' ') + '\n',
    );
    expect(serializeDocToMarkdown(para)).toBe(serializeWholeDocForTests(para));
  });

  it('writes a 4,500-item list in well under a second', () => {
    const md = bigList(4500); // ~400 KB, one top-level block
    const d = parseMarkdownToDoc(md);
    expect(d.childCount).toBe(1);
    const t0 = performance.now();
    const out = serializeDocToMarkdown(d);
    const ms = performance.now() - t0;
    expect(out.length).toBeGreaterThan(300_000);
    console.log(`[perf F16] one ${(md.length / 1024).toFixed(0)} KB list: ${ms.toFixed(0)} ms`);
    // Seconds before; tens of milliseconds here. Generous for slow runners.
    expect(ms).toBeLessThan(2000);
  });
});
