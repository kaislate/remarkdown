import { describe, it, expect, vi, afterEach } from 'vitest';

// WebKit before Safari 16 (macOS 12's) doesn't know the CSP's
// 'wasm-unsafe-eval' and refuses WebAssembly, so Shiki's Oniguruma engine
// can't start there. A document with code in it must still render.

const doc = '# Notes\n\n```ts\nconst a = 1;\n```\n';

function blockWasm() {
  const blocked = () => Promise.reject(new WebAssembly.CompileError('refused by the Content Security Policy'));
  vi.spyOn(WebAssembly, 'instantiate').mockImplementation(blocked);
  vi.spyOn(WebAssembly, 'instantiateStreaming').mockImplementation(blocked);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('shiki/engine/javascript');
  vi.resetModules();
});

describe('code highlighting without WebAssembly', () => {
  it('highlights with the JavaScript regex engine instead', async () => {
    blockWasm();
    const { render } = await import('../../src/lib/MarkdownRenderer');
    const { html } = await render(doc);
    expect(html).toMatch(/class="shiki[^"]*github-dark/);
    expect(html).toMatch(/<span[^>]*style="color:/);
  });

  it('renders the code plain when no engine starts, and tries again next time', async () => {
    blockWasm();
    let engines = 0;
    vi.doMock('shiki/engine/javascript', async (importOriginal) => {
      const real = await importOriginal<typeof import('shiki/engine/javascript')>();
      return {
        ...real,
        createJavaScriptRegexEngine: (...args: Parameters<typeof real.createJavaScriptRegexEngine>) => {
          if (engines++ === 0) throw new Error('no regex engine either');
          return real.createJavaScriptRegexEngine(...args);
        },
      };
    });
    const { render } = await import('../../src/lib/MarkdownRenderer');

    const plain = await render(doc);
    expect(plain.html).toContain('<h1');
    expect(plain.html).toContain('const a = 1;');
    expect(plain.html).not.toMatch(/class="shiki/);

    const again = await render(doc);
    expect(again.html).toMatch(/class="shiki[^"]*github-dark/);
  });
});
