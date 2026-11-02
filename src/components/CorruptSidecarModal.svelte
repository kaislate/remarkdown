<script lang="ts">
  import { activeModal, closeModal } from '../stores/modals';
  import { backupCorruptSidecar } from '../lib/tauri-api';
  import { addToast } from '../stores/toasts';
  import { MAX_ANNOTATIONS } from '../lib/sidecar';
  import { findSessionByPath } from '../stores/tabs';

  async function backupAndStartFresh() {
    if ($activeModal?.kind !== 'corrupt-sidecar') return;
    const path = $activeModal.path;
    try {
      // null: the file is already gone, so there was nothing to back up.
      const backup = await backupCorruptSidecar(path);
      // Nothing is left to protect: the tab may save its annotations again.
      const session = findSessionByPath(path);
      if (session) session.sidecarRefused = false;
      if (backup) addToast({ kind: 'info', message: `Backed up corrupt sidecar to ${backup.split(/[\\/]/).pop()}` });
      closeModal();
    } catch (err) {
      addToast({ kind: 'error', message: `Backup failed: ${String(err)}` });
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && $activeModal?.kind === 'corrupt-sidecar') closeModal();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if $activeModal?.kind === 'corrupt-sidecar'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="scrim" onclick={closeModal} role="presentation">
    <div class="modal glass" role="dialog" aria-modal="true" aria-label="Corrupt sidecar" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <header><h2>Annotations couldn't be loaded</h2></header>
      <p>
        {#if $activeModal.reason === 'unreadable'}
          The annotations file for this document couldn't be read: it's too large, isn't an ordinary file, or isn't text.
        {:else if $activeModal.reason === 'too-many'}
          The annotations file for this document holds more than {MAX_ANNOTATIONS.toLocaleString('en-US')} annotations, or more drawing than the app can show.
        {:else}
          The annotations file for this document is malformed JSON.
        {/if}
        Would you like to back it up and start with a fresh empty annotations file?
      </p>
      <div class="actions">
        <button class="ghost" onclick={closeModal}>Leave as-is</button>
        <button class="primary" onclick={backupAndStartFresh}>Back up and start fresh</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
    z-index: 300;
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
  }
  .modal {
    width: min(440px, 90vw);
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header h2 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--fg-0);
  }
  p {
    margin: 0;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.5;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    background: transparent;
    border: 1px solid var(--glass-border);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--fg-0);
  }
  button:hover { color: var(--fg-0); }
</style>
