import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';

import { annots, currentViewerRoot } from '../../src/stores/annots';
import { viewerScroll } from '../../src/stores/viewport';
import { doc } from '../../src/stores/doc';
import NotesPanel from '../../src/components/NotesPanel.svelte';
import type { Annotation } from '../../src/lib/schema';

function fakeNote(id: string, anchorText: string, body: string): Annotation {
  return {
    id,
    type: 'note',
    body,
    anchor: { text: anchorText, prefix: '', suffix: '', blockHint: 'p:1' },
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

beforeEach(() => {
  annots.set([]);
  currentViewerRoot.set(null);
  viewerScroll.set(null);
  // The pill renders whenever a doc is loaded; tests need to opt in.
  doc.set({
    path: '/tmp/x.md',
    dir: '/tmp',
    sha256: 'x',
    bytes: 0,
    markdown: '',
    html: '',
    plaintext: '',
    blocks: [],
    sidecarRaw: null,
  });
  document.body.innerHTML = '';
});

// Build a real DOM viewer root + scroll container so resolvedAnnots
// returns notes with actual Range objects (the partition() helper
// requires a non-null root and walks for data-block-id elements).
function setupViewer(blocks: Array<{ id: string; text: string }>): HTMLElement {
  const scroll = document.createElement('div');
  scroll.style.height = '600px';
  scroll.style.overflowY = 'auto';
  const root = document.createElement('div');
  for (const b of blocks) {
    const p = document.createElement('p');
    p.dataset.blockId = b.id;
    p.textContent = b.text;
    root.appendChild(p);
  }
  scroll.appendChild(root);
  document.body.appendChild(scroll);
  currentViewerRoot.set(root);
  viewerScroll.set(scroll);
  return root;
}

describe('NotesPanel', () => {
  it('renders nothing when no document is loaded', () => {
    doc.set(null);
    setupViewer([{ id: 'p:1', text: 'Some text' }]);
    render(NotesPanel);
    expect(document.querySelector('.notes-pill-wrap')).toBeNull();
  });

  it('renders the pill even when there are zero notes (so the affordance is discoverable)', () => {
    setupViewer([{ id: 'p:1', text: 'Some text' }]);
    render(NotesPanel);
    expect(document.querySelector('.pill')).not.toBeNull();
    // No count badge when there are no notes
    expect(document.querySelector('.count')).toBeNull();
  });

  it('opens an empty-state popup when there are no notes', async () => {
    setupViewer([{ id: 'p:1', text: 'Some text' }]);
    render(NotesPanel);
    await tick();
    const user = userEvent.setup();
    await user.click(document.querySelector('.pill') as HTMLElement);
    expect(document.querySelector('.empty-state')).not.toBeNull();
    expect(document.querySelector('.empty-state')!.textContent).toContain('No notes yet');
  });

  it('renders the pill with the note count when notes exist', async () => {
    setupViewer([{ id: 'p:1', text: 'Some text here' }]);
    annots.set([
      fakeNote('a', 'Some', 'first note'),
      fakeNote('b', 'text', 'second note'),
    ]);
    render(NotesPanel);
    await tick();
    const pill = document.querySelector('.pill');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain('2');
  });

  it('clicking the pill opens the popup with one row per note', async () => {
    setupViewer([{ id: 'p:1', text: 'Some text here' }]);
    annots.set([
      fakeNote('a', 'Some', 'first'),
      fakeNote('b', 'text', 'second'),
    ]);
    render(NotesPanel);
    await tick();
    const user = userEvent.setup();
    await user.click(document.querySelector('.pill') as HTMLElement);
    const popup = document.querySelector('.popup');
    expect(popup).not.toBeNull();
    expect(document.querySelectorAll('.note-row').length).toBe(2);
  });

  it('shows the anchor excerpt and the note body in each row', async () => {
    setupViewer([{ id: 'p:1', text: 'Some text here' }]);
    annots.set([fakeNote('a', 'Some', 'a thoughtful comment')]);
    render(NotesPanel);
    await tick();
    const user = userEvent.setup();
    await user.click(document.querySelector('.pill') as HTMLElement);
    const row = document.querySelector('.note-row')!;
    expect(row.textContent).toContain('Some');
    expect(row.textContent).toContain('a thoughtful comment');
  });

  it('shows "(empty note)" placeholder for notes with no body', async () => {
    setupViewer([{ id: 'p:1', text: 'Hello world' }]);
    annots.set([fakeNote('a', 'Hello', '')]);
    render(NotesPanel);
    await tick();
    const user = userEvent.setup();
    await user.click(document.querySelector('.pill') as HTMLElement);
    expect(document.querySelector('.body.empty')!.textContent).toContain('empty note');
  });

  it('Esc closes an open popup', async () => {
    setupViewer([{ id: 'p:1', text: 'Some text' }]);
    annots.set([fakeNote('a', 'Some', 'note')]);
    render(NotesPanel);
    await tick();
    const user = userEvent.setup();
    await user.click(document.querySelector('.pill') as HTMLElement);
    expect(document.querySelector('.popup')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(document.querySelector('.popup')).toBeNull();
  });

  it('the row exposes an onclick path (button is interactive)', async () => {
    setupViewer([{ id: 'p:1', text: 'Some text here' }]);
    annots.set([fakeNote('a', 'Some', 'first')]);
    render(NotesPanel);
    await tick();
    const user = userEvent.setup();
    await user.click(document.querySelector('.pill') as HTMLElement);
    const row = document.querySelector('.note-row') as HTMLButtonElement;
    expect(row.tagName).toBe('BUTTON');
    expect(row.disabled).toBe(false);
  });
});
