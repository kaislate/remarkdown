<script lang="ts">
  import { reattachTarget, cancelReattach } from '../stores/reattach';

  // Toggle body class so global styles can flip the cursor + suppress
  // tool-rail interactions while re-attach mode is active.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const active = $reattachTarget !== null;
    document.body.classList.toggle('reattach-mode', active);
    return () => document.body.classList.remove('reattach-mode');
  });
</script>

{#if $reattachTarget}
  <div class="reattach-banner glass" role="status" aria-live="polite">
    <span class="reattach-icon" aria-hidden="true">↻</span>
    <span class="reattach-text">
      <strong>Re-attaching:</strong>
      <span class="reattach-snippet">"{$reattachTarget.snippet}"</span>
      <span class="reattach-hint">— click and drag to pick a new location, or press Esc to cancel.</span>
    </span>
    <button class="reattach-cancel" type="button" onclick={cancelReattach}>
      Cancel
    </button>
  </div>
{/if}

<style>
  .reattach-banner {
    position: fixed;
    top: 50px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 150;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    max-width: 720px;
    color: var(--fg-0);
    border: 1px solid var(--accent-soft);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
    font-family: var(--font-sans);
    font-size: 13px;
    animation: reattachIn 0.18s ease-out;
  }
  .reattach-icon {
    color: var(--accent);
    font-size: 16px;
  }
  .reattach-text {
    flex: 1;
    line-height: 1.4;
  }
  .reattach-snippet {
    color: var(--accent);
    font-style: italic;
  }
  .reattach-hint {
    color: var(--fg-2);
  }
  .reattach-cancel {
    background: var(--accent-soft);
    color: var(--accent);
    border: 0;
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .reattach-cancel:hover { filter: brightness(1.15); }
  @keyframes reattachIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
