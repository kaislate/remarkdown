import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { writable } from 'svelte/store';
import FootnotePopover, { type FootnotePopoverState } from '../../src/components/FootnotePopover.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

// The popover's preview draws the footnote's own markdown, which comes
// straight from the document, so its pictures get the reader's checks.
function previewOf(body: string): HTMLElement {
  const stateStore = writable<FootnotePopoverState>({ open: true, label: '1', body, x: 0, y: 0 });
  app = mount(FootnotePopover, {
    target: document.body,
    props: { stateStore, onSave: () => {}, onDelete: () => {} },
  });
  flushSync();
  const preview = document.querySelector<HTMLElement>('.preview');
  if (!preview) throw new Error('no preview');
  return preview;
}

describe('footnote popover preview', () => {
  it.each([
    ['an asset url to a share', 'http://asset.localhost/%5C%5Cattacker.example%5Cs%5Cx.png'],
    ['a protocol-relative host', '//attacker/x.png'],
    ['an asset url to a local file', 'http://asset.localhost/C%3A%2FUsers%2Fme%2FPictures%2Fp.png'],
    ['an asset: url', 'asset://localhost/%2Fetc%2Fpasswd'],
  ])('never loads %s', (_name, src) => {
    const img = previewOf(`see ![](${src})`).querySelector('img');
    expect(img?.getAttribute('src') ?? '').toBe('');
  });

  it('still shows a web picture as written', () => {
    const img = previewOf('![cat](https://example.com/cat.png)').querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/cat.png');
    expect(img?.getAttribute('alt')).toBe('cat');
  });

  it('still draws the words', () => {
    expect(previewOf('**bold** words').innerHTML).toContain('<strong>bold</strong>');
  });
});
