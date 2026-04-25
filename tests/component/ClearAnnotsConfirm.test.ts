import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { activeModal, openModal, closeModal } from '../../src/stores/modals';
import { annots } from '../../src/stores/annots';
import type { Annotation } from '../../src/lib/schema';
import ClearAnnotsConfirm from '../../src/components/ClearAnnotsConfirm.svelte';

function fakeHighlight(id: string): Annotation {
  return {
    id,
    type: 'highlight',
    color: '#ffd25a',
    anchor: { text: 't', prefix: '', suffix: '', blockHint: 'p:1' },
    createdAt: '2026-04-24T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
  };
}

beforeEach(() => {
  closeModal();
  annots.set([]);
  document.body.innerHTML = '';
});

describe('ClearAnnotsConfirm', () => {
  it('renders nothing when the modal is not active', () => {
    render(ClearAnnotsConfirm);
    expect(document.querySelector('.confirm-panel')).toBeNull();
  });

  it('renders the alert dialog when the confirm-clear-annots modal opens', () => {
    annots.set([fakeHighlight('a'), fakeHighlight('b')]);
    openModal({ kind: 'confirm-clear-annots' });
    render(ClearAnnotsConfirm);
    const panel = document.querySelector('.confirm-panel');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('role')).toBe('alertdialog');
  });

  it('shows the exact annotation count in the description', () => {
    annots.set([fakeHighlight('a'), fakeHighlight('b'), fakeHighlight('c')]);
    openModal({ kind: 'confirm-clear-annots' });
    render(ClearAnnotsConfirm);
    expect(document.querySelector('#confirm-clear-desc')!.textContent).toContain('3 annotations');
  });

  it('uses singular wording for a single annotation', () => {
    annots.set([fakeHighlight('a')]);
    openModal({ kind: 'confirm-clear-annots' });
    render(ClearAnnotsConfirm);
    expect(document.querySelector('#confirm-clear-desc')!.textContent).toContain('1 annotation');
    // Make sure it's NOT pluralised.
    expect(document.querySelector('#confirm-clear-desc')!.textContent).not.toContain('annotations');
  });

  it('disables the Clear all button when there are no annotations', () => {
    annots.set([]);
    openModal({ kind: 'confirm-clear-annots' });
    render(ClearAnnotsConfirm);
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Clear all',
    )!;
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('Cancel closes the modal and leaves annotations untouched', async () => {
    annots.set([fakeHighlight('a'), fakeHighlight('b')]);
    openModal({ kind: 'confirm-clear-annots' });
    render(ClearAnnotsConfirm);
    const user = userEvent.setup();
    await user.click(
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Cancel',
      )!,
    );
    expect(get(activeModal)).toBeNull();
    expect(get(annots).length).toBe(2);
  });

  it('Esc closes without clearing', async () => {
    annots.set([fakeHighlight('a')]);
    openModal({ kind: 'confirm-clear-annots' });
    render(ClearAnnotsConfirm);
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(get(activeModal)).toBeNull();
    expect(get(annots).length).toBe(1);
  });

  it('Clear all empties the annots store and closes the modal', async () => {
    annots.set([fakeHighlight('a'), fakeHighlight('b')]);
    openModal({ kind: 'confirm-clear-annots' });
    render(ClearAnnotsConfirm);
    const user = userEvent.setup();
    await user.click(
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Clear all',
      )!,
    );
    expect(get(annots)).toEqual([]);
    expect(get(activeModal)).toBeNull();
  });

  it('Enter triggers the confirm action when the dialog is open', async () => {
    annots.set([fakeHighlight('a')]);
    openModal({ kind: 'confirm-clear-annots' });
    render(ClearAnnotsConfirm);
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(get(annots)).toEqual([]);
    expect(get(activeModal)).toBeNull();
  });

  it('clicking the scrim closes without clearing', async () => {
    annots.set([fakeHighlight('a')]);
    openModal({ kind: 'confirm-clear-annots' });
    render(ClearAnnotsConfirm);
    const user = userEvent.setup();
    await user.click(document.querySelector('.scrim') as HTMLElement);
    expect(get(activeModal)).toBeNull();
    expect(get(annots).length).toBe(1);
  });
});
