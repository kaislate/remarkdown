// A diagram is part of the document, so a picture it names gets the same
// check as a markdown picture, and it can't slip one in through CSS.
// Real mermaid: the picture is asked for while mermaid lays the diagram
// out, before any svg comes back.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { renderMermaid, resetMermaidRuntimeForTests, warmMermaidRuntime } from '../../src/lib/mermaid-runtime';

(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });

const asked: string[] = [];

beforeAll(async () => {
  // mermaid sizes an image shape from a `new Image()` it loads first.
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 10;
      naturalHeight = 10;
      set src(v: string) {
        asked.push(v);
      }
      decode() {
        return Promise.resolve();
      }
    },
  );
  await warmMermaidRuntime();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetMermaidRuntimeForTests();
  asked.length = 0;
});

const CTX = { theme: 'light' as const, fontFamily: 'serif' };

describe('pictures in a diagram', () => {
  it.each([
    ['a share', String.raw`\\\\attacker.example\\s\\x.png`],
    ['a protocol-relative host', '//attacker.example/x.png'],
    ['an asset url', 'http://asset.localhost/%5C%5Cattacker.example%5Cs%5Cx.png'],
  ])('never asks for %s', async (_name, img) => {
    const outcome = await renderMermaid(`flowchart TD\nA@{ img: "${img}" }`, CTX);
    expect(asked).toEqual([]);
    expect(outcome.ok).toBe(false);
  });

  it('still draws a web picture', async () => {
    const outcome = await renderMermaid('flowchart TD\nA@{ img: "https://example.com/x.png" }', CTX);
    expect(asked).toEqual(['https://example.com/x.png']);
    expect(outcome.ok && outcome.svg).toContain('href="https://example.com/x.png"');
  });

  // CSS can only reach the web, the app's own pages or the asset
  // protocol, whose handler refuses a share, so a diagram keeps its fonts.
  it("keeps the diagram's own font", async () => {
    const outcome = await renderMermaid('%%{init: {"fontFamily": "Comic Neue"}}%%\nflowchart TD\nA --> B', CTX);
    expect(outcome.ok && outcome.svg).toContain('Comic Neue');
  });
});

// Every element mermaid puts in this document while it draws, and every
// attribute it sets: a picture starts loading the moment its <img> is in
// the page, even one mermaid only adds to measure a label and removes.
function watchDocument(): () => string[] {
  const seen: string[] = [];
  const note = (el: Element) => {
    for (const e of [el, ...el.querySelectorAll('*')]) {
      for (const a of e.attributes) seen.push(`${e.localName}[${a.name}=${a.value}]`);
    }
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.target instanceof Element) note(r.target);
      for (const n of r.addedNodes) if (n instanceof Element) note(n);
    }
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true });
  return () => {
    observer.takeRecords().forEach((r) => {
      if (r.type === 'attributes' && r.target instanceof Element) note(r.target);
      for (const n of r.addedNodes) if (n instanceof Element) note(n);
    });
    observer.disconnect();
    return seen;
  };
}

// Every attribute in the svg mermaid hands back (label text may still
// read "<img …>": that's words, not a picture).
function attributesOf(outcome: Awaited<ReturnType<typeof renderMermaid>>): string[] {
  if (!outcome.ok) return [];
  const box = document.createElement('template');
  box.innerHTML = outcome.svg;
  return [...box.content.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => `${e.localName}[${a.name}=${a.value}]`));
}

describe('pictures in a diagram label', () => {
  // Labels may hold HTML, and mermaid's strict mode only takes the script
  // out of it: an <img> in one would be in this page while mermaid lays
  // the diagram out, and in the svg it hands back.
  const share = 'http://asset.localhost/%5C%5Cattacker.example%5Cs%5Cx.png';
  it.each([
    ['a flowchart', `flowchart TD\nA["<img src='${share}'>"]`],
    ['a flowchart, protocol-relative', `flowchart TD\nA["x <img src='//attacker.example/f.png'> y"]`],
    ['a flowchart, as a share', `flowchart TD\nA["<img src='\\\\attacker.example\\s\\x.png'>"]`],
    ['a flowchart, in an svg image', `flowchart TD\nA["<svg><image href='//attacker.example/i.png'/></svg>"]`],
    ['a flowchart, as a poster or srcset', `flowchart TD\nA["<video poster='//attacker.example/p.png'></video><img srcset='//attacker.example/s.png 1x'>"]`],
    ['a state', `stateDiagram-v2\nS: <img src='//attacker.example/st.png'>`],
    ['a mindmap', `mindmap\n  root["<img src='//attacker.example/mm.png'>"]`],
    ['a class member', `classDiagram\nclass C {\n  <img src='//attacker.example/cls.png'>\n}`],
    ['a diagram without html labels', `%%{init: {"htmlLabels": false, "flowchart": {"htmlLabels": false}}}%%\nflowchart TD\nA["<img src='//attacker.example/h.png'>"]`],
    ['a diagram that asks for the default sanitizer back', `%%{init: {"dompurifyConfig": {"FORBID_TAGS": [], "FORBID_ATTR": []}}}%%\nflowchart TD\nA["<img src='//attacker.example/d.png'>"]`],
  ])('in %s never reaches the page', async (_name, source) => {
    const stop = watchDocument();
    const outcome = await renderMermaid(source, CTX);
    const seen = stop();
    expect(seen.filter((s) => s.includes('attacker.example'))).toEqual([]);
    expect(asked).toEqual([]);
    expect(attributesOf(outcome).filter((s) => s.includes('attacker.example'))).toEqual([]);
  });

  it('still draws the words and their formatting', async () => {
    const outcome = await renderMermaid(`flowchart TD\nA["<b>bold</b> <img src='//attacker.example/x.png'> words"]`, CTX);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.svg).toContain('<b>bold</b>');
    expect(outcome.ok && outcome.svg).toContain('words');
  });
});
