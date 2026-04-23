import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import OrphanPanel from '../../src/components/OrphanPanel.svelte';
import { annots, currentViewerRoot, docEpoch } from '../../src/stores/annots';
import { openModal, closeModal, activeModal } from '../../src/stores/modals';

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
  closeModal();
});
afterEach(() => { document.body.innerHTML = ''; });

describe('OrphanPanel', () => {
  it('does not render when modal is closed', () => {
    render(OrphanPanel);
    expect(document.querySelector('.orphan-panel')).toBeNull();
  });

  it('renders when activeModal is orphans', () => {
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    expect(document.querySelector('.orphan-panel')).not.toBeNull();
  });

  it('lists each orphaned annotation with its text excerpt', () => {
    mountViewer('<p data-block-id="p:1">nothing here.</p>');
    flushSync(() => {
      annots.set([
        {
          id: '01A', type: 'highlight', color: '#ffd25a',
          anchor: { text: 'vanished phrase', prefix: 'xxx', suffix: 'yyy', blockHint: 'p:99' },
          createdAt: 'now', updatedAt: 'now',
        },
      ]);
    });
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    expect(screen.getByText(/vanished phrase/)).toBeInTheDocument();
  });

  it('clicking Delete removes the orphan and keeps the modal open', async () => {
    mountViewer('<p data-block-id="p:1">nothing here.</p>');
    flushSync(() => {
      annots.set([
        {
          id: '01A', type: 'highlight', color: '#ffd25a',
          anchor: { text: 'vanished', prefix: 'xxx', suffix: 'yyy', blockHint: 'p:99' },
          createdAt: 'now', updatedAt: 'now',
        },
      ]);
    });
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(get(annots)).toHaveLength(0);
    expect(get(activeModal)).toEqual({ kind: 'orphans' });
  });

  it('clicking Close dismisses the modal', async () => {
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(get(activeModal)).toBeNull();
  });

  it('shows an empty state when no orphans', () => {
    render(OrphanPanel);
    flushSync(() => openModal({ kind: 'orphans' }));
    expect(screen.getByText(/no orphaned/i)).toBeInTheDocument();
  });
});
