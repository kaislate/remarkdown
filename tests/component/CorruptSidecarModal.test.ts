import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  backupCorruptSidecar: vi.fn(),
}));

import { backupCorruptSidecar } from '../../src/lib/tauri-api';
import CorruptSidecarModal from '../../src/components/CorruptSidecarModal.svelte';
import { activeModal, openModal, closeModal } from '../../src/stores/modals';
import { toasts, clearToasts } from '../../src/stores/toasts';

beforeEach(() => {
  closeModal();
  clearToasts();
  vi.mocked(backupCorruptSidecar).mockReset();
});

describe('CorruptSidecarModal', () => {
  it('does not render when modal state is inactive', () => {
    render(CorruptSidecarModal);
    expect(document.querySelector('.modal')).toBeNull();
  });

  it('renders when activeModal is corrupt-sidecar', () => {
    render(CorruptSidecarModal);
    flushSync(() => openModal({ kind: 'corrupt-sidecar', path: '/tmp/a.md' }));
    expect(screen.getByRole('dialog', { name: /corrupt sidecar/i })).toBeInTheDocument();
  });

  it('Leave as-is closes the modal without calling backup', async () => {
    render(CorruptSidecarModal);
    flushSync(() => openModal({ kind: 'corrupt-sidecar', path: '/tmp/a.md' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /leave as-is/i }));
    expect(backupCorruptSidecar).not.toHaveBeenCalled();
    expect(get(activeModal)).toBeNull();
  });

  it('Back up and start fresh calls the Rust command and closes the modal', async () => {
    vi.mocked(backupCorruptSidecar).mockResolvedValue('/tmp/a.md.remarkdown.json.corrupt-1234');
    render(CorruptSidecarModal);
    flushSync(() => openModal({ kind: 'corrupt-sidecar', path: '/tmp/a.md' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /back up/i }));
    expect(backupCorruptSidecar).toHaveBeenCalledWith('/tmp/a.md');
    expect(get(activeModal)).toBeNull();
    expect(get(toasts).some((t) => t.kind === 'info')).toBe(true);
  });
});
