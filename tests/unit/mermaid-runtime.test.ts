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
  buildDiagramError,
  MIN_DIAGRAM_SCALE,
  styleRegexWork,
  tagRegexWork,
  commentRegexWork,
  methodRegexWork,
  genericTypesWork,
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
    mermaidAPI: { render: (id: string, source: string) => {
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
      `flowchart TD\n${'style A fill:#f00;'.repeat(1_500)}`,
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
