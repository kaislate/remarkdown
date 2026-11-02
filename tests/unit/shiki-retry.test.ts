import { describe, it, expect, vi, afterEach } from 'vitest';

// Grammars load one at a time, each the first time it's needed. One that
// fails to load (a chunk that didn't arrive) isn't kept: the code shows
// plain, and the next document that needs it loads it again.

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('shiki/langs/rust.mjs');
  vi.resetModules();
});

describe('a grammar that failed to load is not kept', () => {
  it('a grammar that could not load shows its code plain, and loads next time', async () => {
    let attempts = 0;
    vi.doMock('shiki/langs/rust.mjs', async (importOriginal) => {
      if (attempts++ === 0) throw new Error('chunk failed to load');
      return importOriginal();
    });
    const { render } = await import('../../src/lib/MarkdownRenderer');
    const doc = '```rust\nfn main() {}\n```\n';

    const plain = await render(doc);
    expect(plain.html).toContain('fn main() {}');
    expect(plain.html).not.toMatch(/class="shiki/);

    const coloured = await render(doc);
    expect(coloured.html).toMatch(/class="shiki[^"]*github-dark/);
  });
});
