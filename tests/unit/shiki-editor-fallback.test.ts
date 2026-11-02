import { describe, it, expect, vi, afterEach } from 'vitest';

// The editor shares the reader's highlighter (with every grammar). Where
// WebAssembly is refused and no engine starts, its code stays uncoloured,
// nothing is left unhandled, and the next edit tries again.
// (In a file of its own: Shiki keeps a WebAssembly engine that once started.)

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

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('editor code colouring without WebAssembly', () => {
  it('the editor leaves code uncoloured when no highlighter starts, and colours it on the next edit', async () => {
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
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    const { createEditorView } = await import('../../src/lib/editor/view');
    const { codeBlockHighlightKey } = await import('../../src/lib/editor/code-block-highlight');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = createEditorView(parent, '```ts\nconst a = 1;\n```\n', () => {});
    const coloured = () => (codeBlockHighlightKey.getState(view.state)?.decorations.find().length ?? 0) > 0;
    try {
      await until(() => engines > 0);
      await new Promise((r) => setTimeout(r, 50));
      expect(coloured()).toBe(false);
      expect(unhandled).toEqual([]);

      view.dispatch(view.state.tr.insertText(' ', view.state.doc.content.size - 2));
      await until(coloured);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      view.destroy();
      parent.remove();
    }
  });
});
