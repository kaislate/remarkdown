import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { tick } from 'svelte';

// Mock the Tauri plugin imports BEFORE importing the component, so the
// component picks up the mocked versions when its module is evaluated.
// vi.hoisted lets us declare the mocks above the hoisted vi.mock factory.
const { checkMock, downloadAndInstallMock, getVersionMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  downloadAndInstallMock: vi.fn(),
  getVersionMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: checkMock,
}));
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: getVersionMock,
}));

import { activeModal, openModal, closeModal } from '../../src/stores/modals';
import UpdateModal from '../../src/components/UpdateModal.svelte';

beforeEach(() => {
  closeModal();
  document.body.innerHTML = '';
  checkMock.mockReset();
  downloadAndInstallMock.mockReset();
  getVersionMock.mockReset();
  getVersionMock.mockResolvedValue('0.4.1');
});

async function flushAsync() {
  // Two ticks: one for the $effect to run, one for the awaited promises
  // inside the effect's runCheck() to resolve.
  await tick();
  await Promise.resolve();
  await Promise.resolve();
  await tick();
}

describe('UpdateModal', () => {
  it('renders nothing when the active modal is not "check-update"', () => {
    render(UpdateModal);
    expect(document.querySelector('.update-panel')).toBeNull();
  });

  it('renders the panel with current version when opened', async () => {
    checkMock.mockResolvedValue(null);
    openModal({ kind: 'check-update' });
    render(UpdateModal);
    await flushAsync();
    const panel = document.querySelector('.update-panel');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('0.4.1');
  });

  it('shows "up to date" when check returns null', async () => {
    checkMock.mockResolvedValue(null);
    openModal({ kind: 'check-update' });
    render(UpdateModal);
    await flushAsync();
    expect(document.querySelector('.update-panel')!.textContent)
      .toContain("You're running the latest");
  });

  it('shows "available" + new version when check returns an Update', async () => {
    checkMock.mockResolvedValue({
      version: '0.5.0',
      currentVersion: '0.4.1',
      body: 'Some new things',
      downloadAndInstall: downloadAndInstallMock,
    });
    openModal({ kind: 'check-update' });
    render(UpdateModal);
    await flushAsync();
    const panel = document.querySelector('.update-panel');
    expect(panel!.textContent).toContain('0.5.0');
    expect(panel!.textContent).toContain('Some new things');
  });

  it('shows an error message when check rejects', async () => {
    checkMock.mockRejectedValue(new Error('Network down'));
    openModal({ kind: 'check-update' });
    render(UpdateModal);
    await flushAsync();
    expect(document.querySelector('.update-panel')!.textContent)
      .toContain("Couldn't check for updates");
    expect(document.querySelector('.error-msg')!.textContent)
      .toContain('Network down');
  });

  it('Esc closes the modal', async () => {
    checkMock.mockResolvedValue(null);
    openModal({ kind: 'check-update' });
    render(UpdateModal);
    await flushAsync();
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(get(activeModal)).toBeNull();
  });

  it('clicking the scrim closes the modal', async () => {
    checkMock.mockResolvedValue(null);
    openModal({ kind: 'check-update' });
    render(UpdateModal);
    await flushAsync();
    const user = userEvent.setup();
    await user.click(document.querySelector('.scrim') as HTMLElement);
    expect(get(activeModal)).toBeNull();
  });

  it('Close button closes the modal', async () => {
    checkMock.mockResolvedValue(null);
    openModal({ kind: 'check-update' });
    render(UpdateModal);
    await flushAsync();
    const user = userEvent.setup();
    const closeBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Close',
    )!;
    await user.click(closeBtn);
    expect(get(activeModal)).toBeNull();
  });

  it('"Check now" button re-runs the check', async () => {
    checkMock.mockResolvedValueOnce(null);
    openModal({ kind: 'check-update' });
    render(UpdateModal);
    await flushAsync();
    expect(checkMock).toHaveBeenCalledTimes(1);

    checkMock.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    const checkBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Check now',
    )!;
    await user.click(checkBtn);
    await flushAsync();
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it('"Install update" calls downloadAndInstall on the Update object', async () => {
    downloadAndInstallMock.mockImplementation(async () => {});
    checkMock.mockResolvedValue({
      version: '0.5.0',
      currentVersion: '0.4.1',
      body: '',
      downloadAndInstall: downloadAndInstallMock,
    });
    openModal({ kind: 'check-update' });
    render(UpdateModal);
    await flushAsync();
    const user = userEvent.setup();
    const installBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Install update',
    )!;
    await user.click(installBtn);
    await flushAsync();
    expect(downloadAndInstallMock).toHaveBeenCalledOnce();
  });
});
