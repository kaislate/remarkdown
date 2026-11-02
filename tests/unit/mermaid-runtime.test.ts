// Shared mermaid runtime: one import, one global config, renders
// serialized through a queue, results cached per (theme, font, source).
// mermaid is mocked with deferred renders so the test controls ordering.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderMermaid,
  peekMermaidRender,
  resetMermaidRuntimeForTests,
  setMermaidRenderTimeoutForTests,
  applyDiagramSizing,
  disarmDiagramLinks,
  buildDiagramError,
  MIN_DIAGRAM_SCALE,
  styleRegexWork,
  tagRegexWork,
  commentRegexWork,
  methodRegexWork,
  genericTypesWork,
  whitespaceWork,
  textMermaidSees,
  directiveWork,
  runWork,
  lineTokenWork,
  stackWork,
  blockWork,
  listWork,
} from '../../src/lib/mermaid-runtime';

const mocked = vi.hoisted(() => {
  const log: string[] = [];
  const renders: Array<{
    id: string;
    source: string;
    resolve: (svg?: string) => void;
    reject: (err: unknown) => void;
  }> = [];
  const configs: Array<Record<string, unknown>> = [];
  return { log, renders, configs };
});

vi.mock('mermaid', () => ({
  default: {
    initialize: (config: Record<string, unknown>) => {
      mocked.configs.push(config);
      mocked.log.push(`init:${String(config.theme)}`);
    },
    // mermaid.render() funnels through mermaid's own execution queue,
    // which a render that never settles blocks for good. The runtime
    // serializes renders itself and calls mermaidAPI.render directly.
    render: () => {
      throw new Error('runtime must use mermaidAPI.render, not the queued mermaid.render');
    },
    mermaidAPI: {
      // The picture check parses a diagram that has node data (`@{`) first.
      getDiagramFromText: (source: string) =>
        source.includes('HANG') ? new Promise(() => {}) : Promise.resolve({ db: {} }),
      render: (id: string, source: string) => {
      mocked.log.push(`render:${source}`);
      // Mimic mermaid's temp container on <body>, which it leaves behind
      // when a render fails.
      const tmp = document.createElement('div');
      tmp.id = `d${id}`;
      document.body.appendChild(tmp);
      return new Promise<{ svg: string }>((res, rej) => {
        mocked.renders.push({
          id,
          source,
          resolve: (svg?: string) => {
            tmp.remove();
            res({ svg: svg ?? `<svg id="${id}"><style>#${id} .node{}</style><g id="${id}-L_A_B_0"></g></svg>` });
          },
          reject: (err: unknown) => rej(err),
        });
      });
    } },
  },
}));

async function flush(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
}

const DARK = { theme: 'dark' as const, fontFamily: 'Charter, serif' };
const LIGHT = { theme: 'light' as const, fontFamily: 'Charter, serif' };

beforeEach(() => {
  resetMermaidRuntimeForTests();
  mocked.log.length = 0;
  mocked.renders.length = 0;
  mocked.configs.length = 0;
});

describe('mermaid runtime: a render that never settles', () => {
  it('times out, is not cached, and does not stall the renders queued behind it', async () => {
    setMermaidRenderTimeoutForTests(40);
    try {
      const hung = renderMermaid('flowchart TD\nHANG', DARK);
      const next = renderMermaid('flowchart TD\nB', DARK);
      const out = await hung;
      expect(out.ok).toBe(false);
      expect(out.ok === false && out.transient).toBe(true);
      // A timeout says nothing about the diagram — don't remember it.
      expect(peekMermaidRender('flowchart TD\nHANG', DARK)).toBeNull();
      await flush();
      expect(mocked.renders.map((r) => r.source)).toEqual(['flowchart TD\nHANG', 'flowchart TD\nB']);
      mocked.renders[1].resolve();
      expect((await next).ok).toBe(true);
    } finally {
      setMermaidRenderTimeoutForTests(null);
    }
  });

  it('times out while checking its pictures, and does not stall the renders behind it', async () => {
    setMermaidRenderTimeoutForTests(40);
    try {
      const hung = renderMermaid('flowchart TD\nHANG@{ img: "https://example.com/x.png" }', DARK);
      const next = renderMermaid('flowchart TD\nB', DARK);
      const out = await hung;
      expect(out.ok === false && out.transient).toBe(true);
      await flush();
      expect(mocked.renders.map((r) => r.source)).toEqual(['flowchart TD\nB']);
      mocked.renders[0].resolve();
      expect((await next).ok).toBe(true);
    } finally {
      setMermaidRenderTimeoutForTests(null);
    }
  });
});

describe('mermaid runtime', () => {
  it('serializes renders: the next initialize+render waits for the previous render', async () => {
    const a = renderMermaid('flowchart TD\nA', DARK);
    const b = renderMermaid('flowchart TD\nB', LIGHT);
    await flush();
    expect(mocked.log).toEqual(['init:dark', 'render:flowchart TD\nA']);
    mocked.renders[0].resolve();
    await a;
    await flush();
    expect(mocked.log).toEqual([
      'init:dark',
      'render:flowchart TD\nA',
      'init:default',
      'render:flowchart TD\nB',
    ]);
    mocked.renders[1].resolve();
    expect((await b).ok).toBe(true);
  });

  it('applies theme, font, strict security and suppressed error rendering on every render', async () => {
    const p = renderMermaid('flowchart TD\nA', LIGHT);
    await flush();
    mocked.renders[0].resolve();
    await p;
    expect(mocked.configs[0]).toMatchObject({
      startOnLoad: false,
      theme: 'default',
      fontFamily: 'Charter, serif',
      securityLevel: 'strict',
      suppressErrorRendering: true,
    });
  });

  // Strict security still draws HTML labels, run only through DOMPurify,
  // whose defaults keep forms. A label's form button would send the window
  // wherever the document says. Mermaid's own pass forbids <style>, and
  // this config replaces it.
  it("has mermaid's sanitizer drop form controls from labels", async () => {
    const p = renderMermaid('flowchart TD\nA', LIGHT);
    await flush();
    mocked.renders[0].resolve();
    await p;
    const forbid = (mocked.configs[0].dompurifyConfig as { FORBID_TAGS?: string[] } | undefined)?.FORBID_TAGS;
    expect(forbid).toEqual(expect.arrayContaining(['style', 'form', 'button', 'input', 'select', 'textarea']));
  });

  // WebKit follows a click on MathML with an href, and DOMPurify keeps
  // both. A label's own links have nowhere to go, so their targets go.
  it("has mermaid's sanitizer drop link targets from labels", async () => {
    const p = renderMermaid('flowchart TD\nA', LIGHT);
    await flush();
    mocked.renders[0].resolve();
    await p;
    const forbid = (mocked.configs[0].dompurifyConfig as { FORBID_ATTR?: string[] } | undefined)?.FORBID_ATTR;
    expect(forbid).toEqual(expect.arrayContaining(['href', 'xlink:href']));
  });

  it('caches by (theme, font, source) and hands out a fresh svg id on every hit', async () => {
    const p = renderMermaid('flowchart TD\nA', DARK);
    await flush();
    mocked.renders[0].resolve();
    const first = await p;
    expect(first.ok).toBe(true);

    const hit = peekMermaidRender('flowchart TD\nA', DARK);
    expect(hit?.ok).toBe(true);
    const again = await renderMermaid('flowchart TD\nA', DARK);
    expect(mocked.renders.length).toBe(1); // no second mermaid render
    const ids = [first, hit!, again].map((o) => (o.ok ? /<svg id="([^"]+)"/.exec(o.svg)![1] : ''));
    expect(new Set(ids).size).toBe(3);
    // Every reference to the id is rewritten consistently.
    if (again.ok) {
      const id = ids[2];
      expect(again.svg).toContain(`#${id} .node`);
      expect(again.svg).toContain(`id="${id}-L_A_B_0"`);
      expect(again.svg).not.toContain(ids[0]);
    }

    // Different theme or font misses.
    expect(peekMermaidRender('flowchart TD\nA', LIGHT)).toBeNull();
    expect(peekMermaidRender('flowchart TD\nA', { ...DARK, fontFamily: 'Inter' })).toBeNull();
  });

  it('returns a failure outcome and removes mermaid leftovers from <body>', async () => {
    const p = renderMermaid('flowchart TD\nA[', DARK);
    await flush();
    const { id } = mocked.renders[0];
    expect(document.getElementById(`d${id}`)).not.toBeNull();
    mocked.renders[0].reject(new Error('Parse error on line 2'));
    const out = await p;
    expect(out).toEqual({ ok: false, error: 'Parse error on line 2' });
    expect(document.getElementById(`d${id}`)).toBeNull();
    // Failures are cached too — the same broken source doesn't re-run.
    expect(peekMermaidRender('flowchart TD\nA[', DARK)).toEqual(out);
  });

  // G74: before it lexes anything, mermaid runs /style.*:\S*#.*;/g (and
  // a classDef one) over the source, which on a crafted line tries
  // every `style` × `:` × `#`: 2 KB took seconds, synchronously, so the
  // render timeout could never fire. Such a source is turned away.
  it('turns away a style line mermaid would take seconds over, without calling mermaid', async () => {
    for (const line of ['style:#'.repeat(300), 'style' + ':#'.repeat(2_000), 'classDef:#;' + 'classDef:#'.repeat(300)]) {
      const t0 = performance.now();
      const out = await renderMermaid(`flowchart TD\nA\n${line}`, DARK);
      expect(performance.now() - t0).toBeLessThan(200);
      expect(out.ok).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  // Two more of mermaid's own passes, run on every source before its
  // size limit: cleanupText's /<(\w+)([^>]*)>/g splits a `<word` with
  // no `>` after it every way, and cleanupComments' /^\s*%%…/gm scans
  // the rest of a run of blank lines from each line in it. 40 KB of
  // either took mermaid 5 to 30 s.
  it('turns away a source mermaid would take seconds to clean up', async () => {
    for (const source of [
      `flowchart TD\nA\n<${'a'.repeat(40_000)}`,
      `flowchart TD\nA${' \n'.repeat(20_000)}x`,
      `flowchart TD\nA${'\n'.repeat(40_000)}x`,
    ]) {
      const t0 = performance.now();
      const out = await renderMermaid(source, DARK);
      expect(performance.now() - t0).toBeLessThan(200);
      expect(out.ok).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  it('draws long diagrams with tags, comparisons and blank lines', async () => {
    for (const source of [
      `flowchart TD\n${'A["a<b>x</b> i<n"] --> B\n'.repeat(2_000)}`,
      `erDiagram\n${'A ||--o{ B : "i<n"\n'.repeat(2_000)}`,
      `flowchart TD\nA${'\n'.repeat(1_000)}%% note\n${'\n    '.repeat(300)}B`,
      `---\ntitle: Flow\n---\n%%{init: {"theme": "forest"}}%%\nflowchart TD\n${'A --> B\n'.repeat(5_000)}`,
    ]) {
      const p = renderMermaid(source, DARK);
      await flush();
      expect(mocked.renders.length).toBe(1);
      mocked.renders[0].resolve();
      expect((await p).ok).toBe(true);
      mocked.renders.length = 0;
    }
  });

  it('weighs a source in linear time', () => {
    const t0 = performance.now();
    expect(styleRegexWork('style' + ':#'.repeat(100_000))).toBeGreaterThan(1e8);
    expect(styleRegexWork('style:#;'.repeat(25_000))).toBeLessThan(1e8);
    expect(tagRegexWork(`<${'a'.repeat(200_000)}`)).toBeGreaterThan(1e10);
    expect(commentRegexWork(' \n'.repeat(100_000))).toBeGreaterThan(1e10);
    expect(whitespaceWork(' '.repeat(200_000))).toBeGreaterThan(1e10);
    expect(textMermaidSees('%%{a\n}%%'.repeat(50_000))).toBe('');
    expect(performance.now() - t0).toBeLessThan(500);
  });

  // Lines each under the limit still add up: mermaid runs the style
  // regex over all of them, so 100 lines of 500 bytes took seconds.
  it('turns away many style lines that add up to seconds', async () => {
    const t0 = performance.now();
    const out = await renderMermaid(`flowchart TD\nA\n${`${'style:#'.repeat(70)}\n`.repeat(100)}`, DARK);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(out.ok).toBe(false);
    expect(mocked.renders.length).toBe(0);
  });

  // mermaid drops `%%{…}%%` directives, newlines inside them included,
  // before any of the passes above, so short lines split by directives
  // reach them as one long line (1.8 KB of style line took 2.3 s).
  it('weighs the lines mermaid sees once directives are gone', async () => {
    const split = (piece: string, n: number) => Array(n).fill(piece).join('%%{a\n}%%');
    for (const source of [
      `flowchart TD\nA\n${split('style:#'.repeat(12), 20)}`,
      `flowchart TD\nA\n${split(' \n'.repeat(100), 40)}x`,
      `classDiagram\nA : a)${split('('.repeat(100), 20)}`,
      // Finding the frontmatter is itself slow on this one: it is
      // turned away before that is tried.
      `---${'\n'.repeat(100_000)}${'flowchart TD\nA\n'.repeat(10_000)}`,
    ]) {
      const t0 = performance.now();
      const out = await renderMermaid(source, DARK);
      expect(performance.now() - t0).toBeLessThan(200);
      expect(out.ok).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  // mermaid's flowchart lexer, and the /\s*%%.*\n/gm every diagram goes
  // through, read a run of whitespace again from each character in it:
  // 8,000 spaces in a row took the flowchart parser 2 s, 20,000 took 32.
  it('turns away a long run of spaces', async () => {
    for (const source of [
      `flowchart TD\nA${' '.repeat(8_000)}B`,
      `sequenceDiagram\nA->>B: hi\n${'\t'.repeat(40_000)}B`,
      `flowchart TD\nA${Array(8).fill(' '.repeat(1_000)).join('%%{a}%%')}B`,
    ]) {
      const t0 = performance.now();
      const out = await renderMermaid(source, DARK);
      expect(performance.now() - t0).toBeLessThan(200);
      expect(out.ok).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  // mermaid reads each class member with /([#+~-])?(.+)\((.*)\)…/, which
  // on a member with no `(` before a `)` is cubic (2 KB took seconds),
  // and turns `~` pairs into `<…>` by searching from scratch for each
  // pair (40 KB of `~` took seconds).
  it('turns away a class member mermaid would take seconds over', async () => {
    for (const source of [
      `classDiagram\nclass A {\n  a)${'('.repeat(2_000)}\n}`,
      `classDiagram\nA : a)${'('.repeat(2_000)}`,
      `classDiagram\nclass A {\n  a ${'~'.repeat(45_000)}\n}`,
    ]) {
      const t0 = performance.now();
      const out = await renderMermaid(source, DARK);
      expect(performance.now() - t0).toBeLessThan(200);
      expect(out.ok).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  it('draws classes people write, however many', async () => {
    for (const source of [
      `classDiagram\nclass Animal {\n${'  +eat(Food f, List~int~ xs) Map~K, V~\n  -int age\n'.repeat(2_000)}}`,
      `classDiagram\n${'Animal : +isMammal() bool\n'.repeat(2_000)}`,
      `classDiagram\n${`Animal : ${'eats (a lot) '.repeat(80)}\n`.repeat(100)}`,
      `flowchart TD\nA["${'f(x) '.repeat(4_000)}"]`,
    ]) {
      const p = renderMermaid(source, DARK);
      await flush();
      expect(mocked.renders.length).toBe(1);
      mocked.renders[0].resolve();
      expect((await p).ok).toBe(true);
      mocked.renders.length = 0;
    }
  });

  it('weighs class members in linear time', () => {
    const t0 = performance.now();
    expect(methodRegexWork(`classDiagram\nA : a)${'('.repeat(200_000)}`)).toBeGreaterThan(1e10);
    expect(genericTypesWork(`a${'~'.repeat(200_000)}`)).toBeGreaterThan(1e10);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('draws style lines people write, however long', async () => {
    for (const source of [
      'flowchart TD\nA --> B\nstyle A fill:#f9f,stroke:#333,stroke-width:4px',
      `flowchart TD\n${'style A fill:#f00;\n'.repeat(1_500)}`,
      `flowchart TD\nA["${'a style: #1 '.repeat(2_000)}"]`,
    ]) {
      const p = renderMermaid(source, DARK);
      await flush();
      expect(mocked.renders.length).toBe(1);
      mocked.renders[0].resolve();
      expect((await p).ok).toBe(true);
      mocked.renders.length = 0;
    }
  });

  // Where the style regex does match, it first tries each `#` after the
  // last `;` in the matching `:`'s run, scanning to the end of the line
  // and back for each: 45 KB took mermaid 2 s in a class diagram, 15 s
  // in a flowchart.
  it('weighs the `#`s a matching style line tries first', async () => {
    const line = 'style :#;' + '#'.repeat(45_000);
    expect(styleRegexWork(line)).toBeGreaterThan(1e8);
    for (const header of ['classDiagram\nclass A', 'flowchart TD\nA']) {
      const t0 = performance.now();
      const out = await renderMermaid(`${header}\n${line}`, DARK);
      expect(performance.now() - t0).toBeLessThan(200);
      expect(out.ok).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  // Before its size limit, and before the directives are dropped,
  // mermaid looks for `%%{word …}%%` directives with a regex that reads
  // from each `%%{word` to the next `}%%`, or to the end: 80 KB of
  // unclosed ones took 4.5 s.
  it('turns away unclosed directives mermaid would take seconds to look for', async () => {
    expect(directiveWork('%%{a'.repeat(20_000))).toBeGreaterThan(1e8);
    expect(directiveWork('%%{init: {"theme": "dark"}}%%\n'.repeat(2_000))).toBeLessThan(1e6);
    for (const source of [
      `flowchart TD\nA-->B\n${'%%{a'.repeat(20_000)}`,
      `flowchart TD\nA-->B\n${'%%{a\n'.repeat(20_000)}`,
      `flowchart TD\nA-->B\n${'%%{ a '.repeat(10_000)}`,
    ]) {
      const t0 = performance.now();
      const out = await renderMermaid(source, DARK);
      expect(performance.now() - t0).toBeLessThan(200);
      expect(out.ok).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  // mermaid's lexers and parsers have more slow spots than can be listed
  // one regex at a time, so the shape of the text is weighed as well:
  //   - a long run with no space in it: the flowchart lexer, among
  //     others, reads the rest of the run again for each token in it
  //     (20,000 `#`, `&` or `;` took 5 to 6 s);
  //   - many tokens on one long line, in the diagrams whose lexers read
  //     the rest of the line for each token (16 KB of `a ` took 5 s);
  //   - many tokens on many lines, in the diagrams whose parsers copy
  //     their whole stack for each step (8,000 lines of `a` took a class
  //     diagram 16 s, 40 KB of requirement diagram 8 s, and 10,000
  //     kanban items, linear but slow, 3 s).
  it('turns away text whose shape mermaid would take seconds over', async () => {
    for (const source of [
      `flowchart TD\nA\n${'#'.repeat(20_000)}`,
      `flowchart TD\nA\n${'&'.repeat(20_000)}`,
      `flowchart TD\nA\n${';'.repeat(20_000)}`,
      `classDiagram\nclass A\n${'-a'.repeat(8_000)}`,
      `classDiagram\nclass A\n${'a\n'.repeat(8_000)}`,
      `block-beta\nA\n${'a '.repeat(8_000)}`,
      `erDiagram\nA ||--o{ B : x\n${'a '.repeat(8_000)}`,
      `stateDiagram-v2\nA\n${'a ;\n'.repeat(4_000)}`,
      `radar-beta\naxis a\n${'}\n'.repeat(8_000)}`,
      `gitGraph\ncommit\n${':\n'.repeat(8_000)}`,
      `requirementDiagram\n${'#\n'.repeat(20_000)}`,
      `kanban\n  col\n${'  a\n'.repeat(10_000)}`,
    ]) {
      const t0 = performance.now();
      const out = await renderMermaid(source, DARK);
      expect(performance.now() - t0, source.slice(0, 30)).toBeLessThan(200);
      expect(out.ok, source.slice(0, 30)).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  it('draws diagrams people write, at any size mermaid takes', async () => {
    for (const source of [
      `classDiagram\n${Array.from({ length: 400 }, (_, i) => `C${i} <|-- C${i + 1} : extends\n`).join('')}`,
      `classDiagram\nclass Animal {\n${'  +int age\n'.repeat(1_000)}}`,
      `stateDiagram-v2\n${Array.from({ length: 600 }, (_, i) => `S${i} --> S${i + 1} : go\n`).join('')}`,
      `gitGraph\n${Array.from({ length: 800 }, (_, i) => `commit id: "c${i}"\n`).join('')}`,
      `erDiagram\n${Array.from({ length: 2_000 }, (_, i) => `E${i} ||--o{ E${i + 1} : has\n`).join('')}`,
      `sequenceDiagram\nA->>B: ${'word '.repeat(9_000)}`,
      `flowchart TD\nA["${'https://example.com/a/b/c?d=e '.repeat(1_400)}"]`,
      `mindmap\n  root\n${`    ${'words in a long branch '.repeat(80)}\n`.repeat(20)}`,
      // Past mermaid's size limit: it draws its own notice instead.
      `classDiagram\n${'a\n'.repeat(30_000)}`,
    ]) {
      const p = renderMermaid(source, DARK);
      await flush();
      expect(mocked.renders.length, source.slice(0, 30)).toBe(1);
      mocked.renders[0].resolve();
      expect((await p).ok).toBe(true);
      mocked.renders.length = 0;
    }
  });

  // The weighing above skipped the diagram types whose lexers and
  // parsers were thought linear, but some aren't: an xychart's axis or
  // data list, a sankey's rows, a C4 diagram's statements and a
  // flowchart's `&` or style list are quadratic in mermaid 11.14
  // (48 KB of x-axis took 63 s, 8,000 sankey rows 30 s, 12,000 `&` 14 s).
  // So every type is weighed now, except the ones measured linear.
  it('turns away chart rows and lists mermaid would take seconds over', async () => {
    for (const source of [
      'xychart\nx-axis [' + 'a, '.repeat(16_000) + 'a]',
      'xychart\nx-axis [' + 'a, '.repeat(4_000) + 'a]',
      'xychart\nline [' + '1, '.repeat(16_000) + '1]',
      'sankey\n' + 'a,b,1\n'.repeat(8_000),
      'sankey\n' + 'a,b,1\n'.repeat(2_000),
      'flowchart TD\n' + 'a & '.repeat(12_000) + 'a',
      'flowchart TD\nstyle a ' + 'x:y, '.repeat(9_000) + 'x:y',
      'flowchart TD\n' + 'a & a;'.repeat(6_000),
      // Any statements on one line: the flowchart lexer reads the rest
      // of the line for each token (1,500 style statements took 1.8 s).
      'flowchart TD\nA\n' + 'style A fill:red;'.repeat(1_500),
      'C4Context\n' + 'Person(a, "b")\n'.repeat(3_200),
      'C4Context\nPerson(a, ' + '"b", '.repeat(6_000) + '"b")',
      'radar-beta\naxis ' + 'a, '.repeat(8_000) + 'a',
      // An xychart's list goes on past a line that ends in a space or a
      // tab (48 KB of one label per line took 20 s), and a `]` in a
      // string closes nothing.
      'xychart\nx-axis [' + 'a, \n'.repeat(12_000) + 'a]',
      'xychart\nx-axis [' + 'a,\t\n'.repeat(12_000) + 'a]',
      'xychart\nline [' + '1, \n'.repeat(12_000) + '1]',
      'xychart\nx-axis [' + 'a, \n'.repeat(3_000) + 'a]',
      'xychart\nx-axis [' + '"a]", \n'.repeat(5_000) + 'a]',
      'xychart\nline [' + '1, '.repeat(5_000) + '1]',
    ]) {
      const t0 = performance.now();
      const out = await renderMermaid(source, DARK);
      expect(performance.now() - t0, source.slice(0, 30)).toBeLessThan(200);
      expect(out.ok, source.slice(0, 30)).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  it('draws the charts, flowcharts and C4 diagrams people write', async () => {
    const list = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join(', ');
    for (const source of [
      'xychart\n    title "Sales Revenue"\n    x-axis [jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec]\n' +
        '    y-axis "Revenue (in $)" 4000 --> 11000\n    bar [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]\n' +
        '    line [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]',
      // A year of daily readings, three series.
      `xychart\nx-axis [${list(366, (i) => `d${i}`)}]\n${`line [${list(366, (i) => `${i}.5`)}]\n`.repeat(3)}`,
      // Two years of daily readings, and longer series: a list of plain
      // numbers is read far faster than labels (3,000 took 0.2 s).
      `xychart\nx-axis 0 --> 730\n${`line [${list(730, (i) => `${50 + (i * 37) % 50}`)}]\n`.repeat(3)}`,
      `xychart\n${`bar [${list(1_000, (i) => `${i}`)}]\n`.repeat(2)}`,
      `xychart\nline [${list(3_000, (i) => `${i % 97}.25`)}]`,
      // Labels one per line, with commas in their strings.
      `xychart\nx-axis [${Array.from({ length: 1_000 }, (_, i) => `"Jan ${i}, 2024"`).join(', \n')}]`,
      `sankey\n${Array.from({ length: 300 }, (_, i) => `Source ${i},Target ${i % 17},${i}.5\n`).join('')}`,
      'sankey\n"Agricultural \'waste\'",Bio-conversion,124.729\nBio-conversion,Liquid,0.597\nBio-conversion,Losses,26.862\n',
      `flowchart TD\n${Array.from({ length: 80 }, (_, i) => `a${i} & b${i} & c${i} --> d${i} & e${i}\n`).join('')}`,
      `flowchart TD\nA --> B\n${Array.from({ length: 300 }, (_, i) => `style N${i} fill:#f9f,stroke:#333,stroke-width:4px\n`).join('')}`,
      `flowchart TD\nA --> B\nlinkStyle ${list(400, (i) => `${i}`)} stroke:#f00,stroke-width:2px`,
      'C4Context\n  title System Context diagram for Internet Banking System\n' +
        '  Person(customerA, "Banking Customer A", "A customer of the bank, with personal bank accounts.")\n' +
        '  Enterprise_Boundary(b1, "BankBoundary") {\n    System(SystemAA, "Internet Banking System", "Allows customers to view information.")\n  }\n' +
        '  Rel(customerA, SystemAA, "Uses")\n',
      `C4Context\n${Array.from({ length: 300 }, (_, i) => `Person(p${i}, "Person ${i}", "Someone who uses the system")\n`).join('')}`,
      'radar-beta\n  axis A, B, C, D, E\n  curve c1{1, 2, 3, 4, 5}\n  curve c2{5, 4, 3, 2, 1}',
    ]) {
      const p = renderMermaid(source, DARK);
      await flush();
      expect(mocked.renders.length, source.slice(0, 30)).toBe(1);
      mocked.renders[0].resolve();
      expect((await p).ok).toBe(true);
      mocked.renders.length = 0;
    }
  });

  // mermaid's parsers copy their whole stack on every step, and each
  // block a sequence diagram or flowchart has open, and each branch
  // (`else`, `and`, `option`) of one, keeps the stack a little deeper:
  // 3,000 `else` branches took 4.8 s, 3,000 nested loops 4 s, 2,400
  // nested subgraphs 3.9 s.
  it('turns away blocks nested or branched thousands deep', async () => {
    for (const source of [
      'sequenceDiagram\nalt x\n' + 'A->>B: x\nelse y\n'.repeat(3_000) + 'end',
      'sequenceDiagram\ncritical x\n' + 'A->>B: x\noption y\n'.repeat(2_700) + 'end',
      'sequenceDiagram\ncritical x\n' + 'option y\n'.repeat(3_000) + 'end',
      'sequenceDiagram\npar x\n' + 'A->>B: x\nand y\n'.repeat(3_000) + 'end',
      'sequenceDiagram\n' + 'loop x\n'.repeat(3_000) + 'end\n'.repeat(3_000),
      'sequenceDiagram\n' + 'rect rgb(0,0,0)\n'.repeat(2_400) + 'A->>B: x\n' + 'end\n'.repeat(2_400),
      'sequenceDiagram\n' + 'opt x\n'.repeat(1_000) + 'A->>B: x\n'.repeat(3_000) + 'end\n'.repeat(1_000),
      // `;` ends a statement as a line break does.
      'sequenceDiagram\nalt x;' + 'A->>B: x;else y;'.repeat(2_000) + 'end',
      // An `end` inside an actor's data or a description closes nothing.
      'sequenceDiagram\n' + 'loop x\n'.repeat(1_500) + 'participant A@{ "type": "database", "alias": a\n' + 'end\n'.repeat(1_500) + '}\n' + 'A->>B: x\n'.repeat(3_000),
      'sequenceDiagram\n' + 'loop x\n'.repeat(1_500) + 'accDescr {\n' + 'end\n'.repeat(1_500) + '}\n' + 'A->>B: x\n'.repeat(3_000),
      // An `end` closes a block, and what follows it on its line is read
      // as a new statement that can open another one, or a branch.
      'sequenceDiagram\n' + 'loop a\nend loop a\n'.repeat(2_200) + 'end\n'.repeat(2_200),
      'sequenceDiagram\nalt x\n' + 'loop b\nend else c\n'.repeat(2_600) + 'end',
      'sequenceDiagram\ncritical x\n' + 'loop b\nend option c\n'.repeat(2_400) + 'end',
      'sequenceDiagram\npar x\n' + 'loop b\nend and c\n'.repeat(2_600) + 'end',
      // A title or description can go on to the next line, and an `end`
      // there closes nothing.
      'sequenceDiagram\n' + 'loop x\n'.repeat(1_200) + 'title\nend\n'.repeat(1_200) + 'A->>B: x\n'.repeat(3_000),
      'sequenceDiagram\n' + 'loop x\n'.repeat(1_200) + 'accTitle:\nend\n'.repeat(1_200) + 'A->>B: x\n'.repeat(2_500),
      'sequenceDiagram\n' + 'loop x\n'.repeat(1_200) + 'accDescr:\nend\n'.repeat(1_200) + 'A->>B: x\n'.repeat(2_500),
      'flowchart TD\n' + 'subgraph s\n'.repeat(2_400) + 'x\n' + 'end\n'.repeat(2_400),
      'flowchart TD\n' + 'subgraph s\n'.repeat(1_000) + 'a\n'.repeat(3_000) + 'end\n'.repeat(1_000),
      // A flowchart's `end` can be text inside a label or a string.
      'flowchart TD\n' + 'subgraph s\n'.repeat(1_000) + 'A["\n' + 'end\n'.repeat(1_000) + '"]\n' + 'a\n'.repeat(3_000),
    ]) {
      const t0 = performance.now();
      const out = await renderMermaid(source, DARK);
      expect(performance.now() - t0, source.slice(0, 30)).toBeLessThan(200);
      expect(out.ok, source.slice(0, 30)).toBe(false);
    }
    expect(mocked.renders.length).toBe(0);
  });

  it('draws the sequence diagrams and subgraphs people write', async () => {
    const docs = `sequenceDiagram
    autonumber
    box Purple Alice & John
    participant A as Alice
    participant J as John
    end
    rect rgb(191, 223, 255)
    A->>J: Hello John, how are you?
    alt is sick
        J->>A: Not so good :(
    else is well
        J->>A: Feeling fresh like a daisy
    end
    opt Extra response
        J->>A: Thanks for asking
    end
    end
    par Alice to Bob
        A->>J: Hello guys!
    and Alice to John
        A->>J: Hello guys!
    end
    critical Establish a connection to the DB
        A-->J: connect
    option Network timeout
        A-->J: Log error
    end
    break when the booking process fails
        A-->J: show failure
    end
    loop Every minute
        J-->A: Great!
    end`;
    for (const source of [
      docs,
      // Flat, as long as mermaid takes.
      `sequenceDiagram\n${'A->>B: x\n'.repeat(5_500)}`,
      `sequenceDiagram\n${'loop every minute\n    A->>B: ping\n    B-->>A: pong\nend\n'.repeat(800)}`,
      `sequenceDiagram\n${'alt ok\n  A->>B: yes\nelse no\n  A->>B: no\nend\n'.repeat(800)}`,
      `sequenceDiagram\nloop forever\n${'  A->>B: x\n'.repeat(4_000)}end`,
      `sequenceDiagram\nalt a\n  A->>B: x\n${Array.from({ length: 100 }, (_, i) => `else b${i}\n  A->>B: x\n`).join('')}end`,
      `sequenceDiagram\n${'loop a\n'.repeat(20)}${'  A->>B: x\n'.repeat(2_000)}${'end\n'.repeat(20)}`,
      `sequenceDiagram\nparticipant A@{ "type": "database" }\n${'loop a\n  A->>B: x\nend\n'.repeat(500)}`,
      `sequenceDiagram\ntitle Hello\naccTitle: Pings\naccDescr: Pings and pongs\n${'loop a\n  A->>B: x\nend\n'.repeat(500)}`,
      `sequenceDiagram\n${'loop a\n  A->>B: x\nend loop b\n  A->>B: y\nend\n'.repeat(300)}`,
      `flowchart TD\n${Array.from({ length: 100 }, (_, i) => `subgraph S${i}\n${Array.from({ length: 10 }, (_, j) => `  N${i}_${j} --> N${i}_${j + 1}\n`).join('')}end\n`).join('')}`,
      `flowchart TD\n${'subgraph a\n'.repeat(10)}${'  A --> B\n'.repeat(400)}${'end\n'.repeat(10)}`,
    ]) {
      const p = renderMermaid(source, DARK);
      await flush();
      expect(mocked.renders.length, source.slice(0, 30)).toBe(1);
      mocked.renders[0].resolve();
      expect((await p).ok).toBe(true);
      mocked.renders.length = 0;
    }
  });

  it('weighs the shape of a source in linear time', () => {
    const t0 = performance.now();
    expect(stackWork(`classDiagram\n${'a\n'.repeat(200_000)}`)).toBeGreaterThan(1e10);
    expect(runWork(`flowchart TD\n${'#'.repeat(200_000)}`)).toBeGreaterThan(1e10);
    expect(lineTokenWork(`erDiagram\n${'a '.repeat(100_000)}`)).toBeGreaterThan(1e10);
    expect(directiveWork('%%{a'.repeat(100_000))).toBeGreaterThan(1e10);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  // Past mermaid's size limit, mermaid draws its notice in the diagram's
  // place, and no picture of the diagram's loads. Its shape isn't
  // weighed, so it isn't parsed to look for pictures either: these took
  // mermaid 5 and 2.3 s. (A HANG source never finishes that parse.)
  it("doesn't parse a diagram past mermaid's size limit to check its pictures", async () => {
    for (const source of [
      'sequenceDiagram\nparticipant HANG@{ "type": "database" }\ncritical x\n' + 'A->>B: x\noption y\n'.repeat(3_000) + 'end',
      'sequenceDiagram\nlinks HANG: {"details": "x"}\n' + 'rect rgb(0,0,0)\n'.repeat(2_500) + 'A->>B: x\n' + 'end\n'.repeat(2_500),
    ]) {
      const p = renderMermaid(source, DARK);
      await flush();
      expect(mocked.renders.length, source.slice(0, 40)).toBe(1);
      mocked.renders[0].resolve();
      expect((await p).ok).toBe(true);
      mocked.renders.length = 0;
    }
  });

  it('weighs blocks and lists in linear time', () => {
    const t0 = performance.now();
    expect(blockWork(`sequenceDiagram\n${'loop x\n'.repeat(100_000)}`)).toBeGreaterThan(1e9);
    expect(blockWork(`flowchart TD\n${'subgraph s\n'.repeat(100_000)}`)).toBeGreaterThan(1e9);
    expect(listWork(`xychart\nline [${'1,'.repeat(200_000)}1]`)).toBeGreaterThan(1e9);
    expect(listWork(`xychart\nx-axis [${'a, \n'.repeat(50_000)}a]`)).toBeGreaterThan(1e9);
    // About 0.3 s here, more on a busy CI runner. Quadratic weighing of
    // 100,000 lines would be some 1e10 steps: minutes.
    expect(performance.now() - t0).toBeLessThan(5_000);
  });

  it('a failing render does not wedge the queue', async () => {
    const a = renderMermaid('bad', DARK);
    const b = renderMermaid('good', DARK);
    await flush();
    mocked.renders[0].reject(new Error('nope'));
    await a;
    await flush();
    expect(mocked.renders.length).toBe(2);
    mocked.renders[1].resolve();
    expect((await b).ok).toBe(true);
  });
});

// Renders nobody is waiting for any more (a node view torn down, a
// preview replaced by a newer one) must not hold up the queue, and the
// text panel's live previews must not crowd the open document's diagrams
// out of the cache.
describe('mermaid runtime: skipping and previews', () => {
  it('skips a queued render that is no longer wanted, without running mermaid', async () => {
    let wanted = true;
    const a = renderMermaid('flowchart TD\nA', DARK);
    const b = renderMermaid('flowchart TD\nB', DARK, { isCurrent: () => wanted });
    const c = renderMermaid('flowchart TD\nC', DARK);
    await flush();
    wanted = false;
    mocked.renders[0].resolve();
    await a;
    const out = await b;
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.transient).toBe(true);
    // Not remembered as a failure: drawing it later still works.
    expect(peekMermaidRender('flowchart TD\nB', DARK)).toBeNull();
    await flush();
    expect(mocked.renders.map((r) => r.source)).toEqual(['flowchart TD\nA', 'flowchart TD\nC']);
    mocked.renders[1].resolve();
    expect((await c).ok).toBe(true);
  });

  it('still draws a render that is wanted', async () => {
    const p = renderMermaid('flowchart TD\nA', DARK, { isCurrent: () => true });
    await flush();
    mocked.renders[0].resolve();
    expect((await p).ok).toBe(true);
    expect(peekMermaidRender('flowchart TD\nA', DARK)?.ok).toBe(true);
  });

  async function preview(source: string) {
    const p = renderMermaid(source, DARK, { preview: true });
    await flush();
    mocked.renders.at(-1)!.resolve();
    return p;
  }

  it('previews keep only the latest; a saved preview still paints at once', async () => {
    expect((await preview('flowchart TD\nP1')).ok).toBe(true);
    expect((await preview('flowchart TD\nP2')).ok).toBe(true);
    // The older preview is gone...
    expect(peekMermaidRender('flowchart TD\nP1', DARK)).toBeNull();
    // ...the latest is found (and from then on is cached like any diagram).
    expect(peekMermaidRender('flowchart TD\nP2', DARK)?.ok).toBe(true);
    expect(peekMermaidRender('flowchart TD\nP2', DARK)?.ok).toBe(true);
    // A preview of the same text again needs no second render.
    await renderMermaid('flowchart TD\nP2', DARK, { preview: true });
    expect(mocked.renders).toHaveLength(2);
  });

  it('minutes of previews leave the document\'s diagrams in the cache', async () => {
    const doc = renderMermaid('flowchart TD\nDOC', DARK);
    await flush();
    mocked.renders[0].resolve();
    await doc;
    for (let i = 0; i < 310; i++) await preview(`flowchart TD\nP${i}`);
    expect(peekMermaidRender('flowchart TD\nDOC', DARK)?.ok).toBe(true);
  });
});

describe('applyDiagramSizing', () => {
  function svgWith(attrs: Record<string, string>): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    return svg;
  }

  it(`never lets a diagram shrink below ${MIN_DIAGRAM_SCALE * 100}% of its natural width`, () => {
    const svg = svgWith({ viewBox: '0 0 1200 300', width: '100%', style: 'max-width: 1200px;' });
    applyDiagramSizing(svg);
    expect(svg.style.minWidth).toBe('900px');
    expect(svg.style.maxWidth).toBe('1200px');
  });

  it('leaves small diagrams fluid (min-width below the column width)', () => {
    const svg = svgWith({ viewBox: '-8 -8 200 120', width: '100%', style: 'max-width: 200px;' });
    applyDiagramSizing(svg);
    expect(svg.style.minWidth).toBe('150px');
    expect(svg.style.maxWidth).toBe('200px');
  });

  it('ignores svgs without a usable natural size', () => {
    const svg = svgWith({ width: '100%' });
    applyDiagramSizing(svg);
    expect(svg.style.minWidth).toBe('');
  });
});

describe('disarmDiagramLinks', () => {
  // What mermaid draws for `click A href "…"` (and gantt/class links):
  // the node wrapped in an svg <a>, under strict security too.
  it('takes the target off every link in a diagram and keeps the node', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<a xlink:href="https://attacker.example/" target="_blank"><g class="node" id="flowchart-A-0"><text>A</text></g></a>' +
      '<a href="http://asset.localhost/r.html"><g class="node" id="flowchart-B-1"></g></a>' +
      '</svg>';
    disarmDiagramLinks(host);
    const links = [...host.querySelectorAll('a')];
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBeNull();
      expect(a.getAttribute('href')).toBeNull();
      expect(a.getAttribute('target')).toBeNull();
    }
    expect(host.querySelector('#flowchart-A-0')).not.toBeNull();
  });

  // An HTML label (in a foreignObject) can hold a form whose button sends
  // the window to the form's action. The controls go; their words stay.
  it('takes the form controls out of a label and keeps its words', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg"><g class="node"><foreignObject><div><span class="nodeLabel">' +
      '<form action="http://xn--a.attacker.example/"><button>Update required</button>' +
      '<input name="q"><select><option>a</option></select><textarea>t</textarea></form>' +
      '</span></div></foreignObject></g></svg>';
    disarmDiagramLinks(host);
    expect(host.querySelector('form, button, input, select, textarea')).toBeNull();
    expect(host.querySelector('.nodeLabel')?.textContent).toBe('Update required');
  });
});

describe('disarmDiagramLinks on what is not an <a>', () => {
  // WebKit (macOS and Linux) follows a click on any MathML element with an
  // href; an HTML label can hold MathML, and an image map's <area> too.
  // Mermaid's own pictures (svg <image>, and <use>) keep theirs.
  it('takes the target off MathML and area links, and keeps the pictures', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<g class="node"><foreignObject><div><span class="nodeLabel">' +
      '<math href="tauri://localhost/"><mrow href="http://127.0.0.1:9/pwned"><mi>x</mi></mrow></math>' +
      '<map name="m"><area shape="rect" coords="0,0,9,9" href="http://127.0.0.1:9/area"></map>' +
      '</span></div></foreignObject></g>' +
      '<image href="data:image/png;base64,AA==" xlink:href="data:image/png;base64,AA=="></image>' +
      '<use href="#icon"></use>' +
      '</svg>';
    const mrow = host.querySelector('mrow')!;
    mrow.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'http://127.0.0.1:9/x');
    expect(mrow.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
    disarmDiagramLinks(host);
    for (const el of host.querySelectorAll('math, mrow, area')) {
      expect(el.getAttribute('href'), el.localName).toBeNull();
      expect(el.getAttributeNS('http://www.w3.org/1999/xlink', 'href'), el.localName).toBeNull();
    }
    expect(host.querySelector('mi')?.textContent).toBe('x');
    expect(host.querySelector('image')?.getAttribute('href')).toBe('data:image/png;base64,AA==');
    expect(host.querySelector('image')?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('data:image/png;base64,AA==');
    expect(host.querySelector('use')?.getAttribute('href')).toBe('#icon');
  });
});

describe('buildDiagramError', () => {
  it('shows a friendly message with the technical details collapsed', () => {
    const el = buildDiagramError('Parse error on line 3:\nExpecting SQE');
    expect(el.classList.contains('mermaid-error')).toBe(true);
    expect(el.querySelector('.mermaid-error-title')?.textContent).toBe(
      "This diagram couldn't be displayed.",
    );
    const details = el.querySelector('details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.textContent).toContain('Expecting SQE');
    // The jargon is only inside the collapsed details.
    const outside = Array.from(el.childNodes)
      .filter((n) => n !== details)
      .map((n) => n.textContent)
      .join('');
    expect(outside).not.toContain('Parse error');
    expect(el.querySelector('.mermaid-error-hint')).toBeNull();
  });

  it('optionally adds the undo hint', () => {
    const el = buildDiagramError('boom', { undoHint: true });
    expect(el.querySelector('.mermaid-error-hint')?.textContent).toMatch(
      /Press (Ctrl\+|⌘)Z to undo the last change/
    );
  });
});
