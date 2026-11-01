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

  it('takes no CSS from the diagram', async () => {
    const outcome = await renderMermaid(
      '%%{init: {"themeCSS": ".node rect { fill: url(//attacker.example/x.png); }", "fontFamily": "x; background: url(//attacker.example/y.png)"}}%%\nflowchart TD\nA --> B',
      CTX,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.svg).not.toContain('attacker.example');
  });
});
