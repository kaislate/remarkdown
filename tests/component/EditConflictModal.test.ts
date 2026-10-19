import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/lib/edit-save', () => ({ resolveEditConflict: vi.fn(async () => {}) }));

import EditConflictModal from '../../src/components/EditConflictModal.svelte';
import { resolveEditConflict } from '../../src/lib/edit-save';
import { openModal, closeModal } from '../../src/stores/modals';
import { createSession, sessions } from '../../src/stores/sessions';

function conflicted() {
  const s = createSession();
  s.doc.set({ path: 'C:\\docs\\Plan.md', dir: 'C:\\docs', sha256: 'x', bytes: 1, markdown: '', html: '', plaintext: '', blocks: [], sidecarRaw: null });
  s.editConflict = true;
  sessions.set([s]);
  openModal({ kind: 'edit-conflict', sessionId: s.id });
  return s;
}

describe('EditConflictModal', () => {
  beforeEach(() => {
    vi.mocked(resolveEditConflict).mockClear();
    closeModal();
  });

  it('names the file without its extension and explains what happened', () => {
    conflicted();
    render(EditConflictModal);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Plan/)).toBeInTheDocument();
    expect(screen.queryByText(/\.md/)).toBeNull();
    expect(screen.getByText(/changed by another program/i)).toBeInTheDocument();
  });

  it.each([
    ['Keep my version', 'keep'],
    ['Use the other version', 'theirs'],
    ['Save mine as a copy', 'copy'],
  ])('"%s" resolves with %s', async (label, choice) => {
    const s = conflicted();
    render(EditConflictModal);
    await userEvent.setup().click(screen.getByRole('button', { name: label }));
    expect(resolveEditConflict).toHaveBeenCalledWith(s, choice);
  });

  it('cannot be dismissed without choosing (Esc does nothing)', async () => {
    conflicted();
    render(EditConflictModal);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(resolveEditConflict).not.toHaveBeenCalled();
  });

  it('renders nothing for other dialogs', () => {
    openModal({ kind: 'settings' });
    render(EditConflictModal);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
