import { describe, it, expect, afterEach } from 'vitest';
import { createEditorView } from '../../../src/lib/editor/view';
import { editorSchema } from '../../../src/lib/editor/schema';
import { DOMSerializer } from 'prosemirror-model';
import { resolveImageSrc } from '../../../src/lib/image-paths';

// Setting an <img>'s src starts the request, even before the picture is
// on the page, so every src the editor ever hands one is recorded.
const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
let seen: string[] = [];
function recordSrcs() {
  seen = [];
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get: desc.get,
    set(v: string) {
      seen.push(v);
      desc.set!.call(this, v);
    },
  });
}
afterEach(() => Object.defineProperty(HTMLImageElement.prototype, 'src', desc));

const unsafe = '![x](http://asset.localhost/%5C%5Cattacker.example%5Cs%5Cx.png)\n';

describe('editor pictures', () => {
  it('never hands an <img> the asset url a document names', () => {
    recordSrcs();
    const host = document.createElement('div');
    const v = createEditorView(host, unsafe, () => {}, undefined, (src) => resolveImageSrc(src, 'C:/docs', (p) => `asset:${p}`));
    expect(seen.some((s) => s.includes('attacker'))).toBe(false);
    expect(host.querySelector('img')!.getAttribute('src')).toBe('');
    v.destroy();
  });

  it('never does without a resolver either', () => {
    recordSrcs();
    const host = document.createElement('div');
    const v = createEditorView(host, unsafe, () => {});
    expect(seen.some((s) => s.includes('attacker'))).toBe(false);
    v.destroy();
  });

  it('still shows an ordinary picture through the resolver', () => {
    recordSrcs();
    const host = document.createElement('div');
    const v = createEditorView(host, '![x](img/a.png)\n', () => {}, undefined, (src) => resolveImageSrc(src, 'C:/docs', (p) => `asset:${p}`));
    expect(host.querySelector('img')!.getAttribute('src')).toBe('asset:C:/docs/img/a.png');
    expect(seen).not.toContain('img/a.png');
    v.destroy();
  });

  it('copies an unsafe picture without its src, an ordinary one with it', () => {
    // Copying serializes the selection into <img> elements of this document.
    recordSrcs();
    const host = document.createElement('div');
    const v = createEditorView(host, unsafe + '\n![y](img/a.png)\n', () => {});
    seen = [];
    const html = document.createElement('div');
    html.appendChild(DOMSerializer.fromSchema(editorSchema).serializeFragment(v.state.doc.content, { document }));
    expect(seen.some((s) => s.includes('attacker'))).toBe(false);
    expect(html.innerHTML).not.toContain('attacker');
    expect(html.innerHTML).toContain('src="img/a.png"');
    v.destroy();
  });
});
