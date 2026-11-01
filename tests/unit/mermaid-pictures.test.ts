// A diagram is part of the document, so a picture it names gets the same
// check as a markdown picture, and it can't slip one in through CSS.
// Real mermaid: the picture is asked for while mermaid lays the diagram
// out, before any svg comes back.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { drawsUnsafePicture, renderMermaid, resetMermaidRuntimeForTests, warmMermaidRuntime } from '../../src/lib/mermaid-runtime';
import { isUnsafeImageSrc } from '../../src/lib/image-paths';

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

describe('pictures a diagram spells with codes, or gives a sequence actor', () => {
  // mermaid reads #92; as a backslash (and #58; as a colon, #47; as a
  // slash) only once it writes the svg, so the picture the svg names is
  // not the one written in the source. A sequence diagram's actor can have
  // an icon too, which mermaid draws as an svg picture.
  const asset = 'http://asset.localhost/%5C%5Cattacker.example%5Cs%5Cx.png';
  // Escaped for JSON: the icon is \\attacker.example\s\x.png.
  const share = String.raw`\\\\attacker.example\\s\\x.png`;
  const actor = (props: string) => `sequenceDiagram\nparticipant A\n${props}\nA->>A: hi`;
  beforeAll(() => {
    const details = document.createElement('div');
    details.id = 'rmd-test-actor-details';
    details.textContent = JSON.stringify({ properties: { icon: asset } });
    document.body.appendChild(details);
  });

  it.each([
    ['#58; in an asset url', 'flowchart TD\nA@{ img: "http#58;//asset.localhost/%5C%5Cattacker.example%5Cs%5Cx.png" }'],
    ['#92; in a share', 'flowchart TD\nA@{ img: "#92;#92;attacker.example#92;s#92;x.png" }'],
    ['#47; in a protocol-relative host', 'flowchart TD\nA@{ img: "#47;#47;attacker.example/x.png" }'],
    ['a sequence icon, an asset url', actor(`properties A: {"icon":"${asset}"}`)],
    ['a sequence icon, a share', actor(`properties A: {"icon":"${share}"}`)],
    ['a sequence icon, #58; in an asset url', actor('properties A: {"icon":"http#58;//asset.localhost/%5C%5Cattacker.example%5Cs%5Cx.png"}')],
    ['a sequence icon, #92; in a share', actor('properties A: {"icon":"#92;#92;attacker.example#92;s#92;x.png"}')],
    ['a sequence icon from details', actor('details A: rmd-test-actor-details')],
  ])('%s is never drawn', async (_name, source) => {
    const stop = watchDocument();
    const outcome = await renderMermaid(source, CTX);
    const seen = stop();
    expect(outcome.ok).toBe(false);
    expect(seen.filter((s) => s.includes('attacker.example'))).toEqual([]);
    expect(asked.filter(isUnsafeImageSrc)).toEqual([]);
  });

  // mermaid keeps an HTML code's & as an &, so this names a file in the
  // app's own folder, not a share.
  it('draws &#92; as written', async () => {
    const outcome = await renderMermaid('flowchart TD\nA@{ img: "&#92;&#92;attacker.example&#92;s&#92;x.png" }', CTX);
    expect(outcome.ok && outcome.svg).toContain(String.raw`href="&amp;\&amp;\attacker.example`);
  });

  it('still draws a web icon for a sequence actor', async () => {
    const outcome = await renderMermaid(actor('properties A: {"icon":"https://example.com/i.png"}'), CTX);
    expect(outcome.ok && outcome.svg).toContain('https://example.com/i.png');
  });
});

describe('the svg a diagram comes back as', () => {
  const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  it.each([
    ['an svg image', '<image href="http://asset.localhost/%5C%5Cattacker.example%5Cs%5Cx.png"/>'],
    ['an svg image by xlink', String.raw`<image xlink:href="\\attacker.example\s\x.png"/>`],
    ['an feImage', '<filter><feImage href="//attacker.example/f.png"/></filter>'],
    ['a use', '<use href="asset://localhost/%2Fnet%2Fattacker.example%2Fx.svg#a"/>'],
    ['an img', '<foreignObject><div><img src="file:///C:/x.png"></div></foreignObject>'],
    ['a srcset', '<foreignObject><img srcset="https://example.com/a.png 1x, //attacker.example/s.png 2x"></foreignObject>'],
    ['a poster', '<foreignObject><video poster="//attacker.example/p.png"></video></foreignObject>'],
    ['a background', '<foreignObject><table background="//attacker.example/b.png"></table></foreignObject>'],
  ])('with an unsafe picture in %s is refused', (_name, inner) => {
    expect(drawsUnsafePicture(svg(inner))).toBe(true);
  });

  it('with web pictures, its own links and words is fine', () => {
    expect(
      drawsUnsafePicture(
        svg('<image href="https://example.com/x.png"/><use xlink:href="#rmd-mermaid-1x-arrow"/><path marker-end="url(#m)"/><text>&lt;img src="//attacker.example/x.png"&gt;</text>'),
      ),
    ).toBe(false);
  });
});
