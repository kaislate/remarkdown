<script lang="ts">
  import { activeModal, closeModal } from '../stores/modals';
  import { annots, replaceAll } from '../stores/annots';

  function onKeydown(e: KeyboardEvent) {
    if ($activeModal?.kind !== 'confirm-clear-annots') return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter') confirmClear();
  }

  function confirmClear() {
    replaceAll([]);
    closeModal();
  }

  // Live count so the confirmation copy reflects the user's exact situation.
  const count = $derived($annots.length);
</script>

<svelte:window onkeydown={onKeydown} />

{#if $activeModal?.kind === 'confirm-clear-annots'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="scrim" onclick={closeModal} role="presentation">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="confirm-panel glass"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-clear-title"
      aria-describedby="confirm-clear-desc"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 id="confirm-clear-title">Clear all annotations?</h2>
      <p id="confirm-clear-desc">
        {#if count === 0}
          There are no annotations to clear.
        {:else if count === 1}
          This will permanently delete <strong>1 annotation</strong>
          from the current document. This cannot be undone.
        {:else}
          This will permanently delete <strong>{count} annotations</strong>
          from the current document. This cannot be undone.
        {/if}
      </p>
      <div class="actions">
        <button class="cancel" onclick={closeModal}>Cancel</button>
        <button class="danger" onclick={confirmClear} disabled={count === 0}>
          Clear all
        </button>
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
    z-index: 320;
    backdrop-filter: blur(2px);
  }
  .confirm-panel {
    width: min(420px, 90vw);
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* Same near-opaque trick as SettingsModal — the body's accent glow
       can otherwise bleed through and make the alert hard to read. */
    background:
      linear-gradient(var(--bg-1), var(--bg-1)),
      var(--glass-fill);
  }
  h2 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--fg-0);
  }
  p {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.5;
    color: var(--fg-1);
  }
  p strong {
    color: var(--fg-0);
    font-weight: 600;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  .actions button {
    background: var(--glass-fill);
    border: 1px solid var(--glass-border);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
  }
  .actions button:hover { color: var(--fg-0); }
  .actions .danger {
    background: #c0392b;
    border-color: #c0392b;
    color: #fff;
  }
  .actions .danger:hover { color: #fff; filter: brightness(1.1); }
  .actions .danger:disabled {
    background: var(--glass-fill);
    border-color: var(--glass-border);
    color: var(--fg-2);
    cursor: default;
    opacity: 0.5;
  }
</style>
