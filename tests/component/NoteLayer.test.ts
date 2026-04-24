import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { flushSync } from 'svelte';
import NoteLayer from '../../src/components/NoteLayer.svelte';
import { annots, currentViewerRoot, docEpoch } from '../../src/stores/annots';
import { setMode } from '../../src/stores/tool';

function mountViewer(html: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = html;
  document.body.appendChild(article);
  currentViewerRoot.set(article);
  docEpoch.update((e) => e + 1);
  return article;
}

beforeEach(() => {
  document.body.innerHTML = '';
  annots.set([]);
  currentViewerRoot.set(null);
  setMode('cursor');
});
afterEach(() => { document.body.innerHTML = ''; });

describe('NoteLayer', () => {
  it('renders a pin for each resolved note annotation', () => {
    mountViewer('<p data-block-id="p:1">Good evening friend</p>');
    render(NoteLayer);
    flushSync(() => {
      annots.set([
        {
          id: '01A', type: 'note', body: 'hello',
          anchor: { text: 'evening', prefix: 'Good ', suffix: ' friend', blockHint: 'p:1' },
          createdAt: 'now', updatedAt: 'now',
        },
      ]);
    });
    const pins = document.querySelectorAll('.note-pin');
    expect(pins.length).toBe(1);
  });

  it('adds a note when the user clicks in note mode', async () => {
    const root = mountViewer('<p data-block-id="p:1">The cat sat on the mat</p>');
    render(NoteLayer);
    flushSync(() => setMode('note'));

    const p = root.querySelector('p')!;
    const user = userEvent.setup();
    await user.click(p);

    const list = get(annots).filter((a) => a.type === 'note');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].type).toBe('note');
  });

  it('opens a popover when a pin is clicked', async () => {
    mountViewer('<p data-block-id="p:1">hi friend</p>');
    render(NoteLayer);
    flushSync(() => {
      annots.set([
        {
          id: '01A', type: 'note', body: 'existing',
          anchor: { text: 'friend', prefix: 'hi ', suffix: '', blockHint: 'p:1' },
          createdAt: 'now', updatedAt: 'now',
        },
      ]);
    });
    const user = userEvent.setup();
    const pin = document.querySelector('.note-pin') as HTMLButtonElement;
    await user.click(pin);
    expect(screen.getByRole('dialog', { name: /note/i })).toBeInTheDocument();
  });
});

describe('NoteLayer — eraser tool', () => {
  it('clicking a pin in eraser mode deletes the note immediately, no popover', async () => {
    mountViewer('<p data-block-id="p:1">hi friend</p>');
    render(NoteLayer);
    flushSync(() => {
      annots.set([
        {
          id: '01A', type: 'note', body: 'existing',
          anchor: { text: 'friend', prefix: 'hi ', suffix: '', blockHint: 'p:1' },
          createdAt: 'now', updatedAt: 'now',
        },
      ]);
      setMode('eraser');
    });
    const user = userEvent.setup();
    const pin = document.querySelector('.note-pin') as HTMLButtonElement;
    await user.click(pin);

    expect(get(annots).filter((a) => a.type === 'note')).toHaveLength(0);
    expect(screen.queryByRole('dialog', { name: /note/i })).toBeNull();
  });

  it('marks pins with the eraser class so the cursor reflects the mode', () => {
    mountViewer('<p data-block-id="p:1">hi friend</p>');
    render(NoteLayer);
    flushSync(() => {
      annots.set([
        {
          id: '01A', type: 'note', body: '',
          anchor: { text: 'friend', prefix: 'hi ', suffix: '', blockHint: 'p:1' },
          createdAt: 'now', updatedAt: 'now',
        },
      ]);
      setMode('eraser');
    });
    const pin = document.querySelector('.note-pin') as HTMLButtonElement;
    expect(pin.classList.contains('eraser')).toBe(true);
    expect(pin.getAttribute('aria-label')).toMatch(/erase/i);
  });
});
