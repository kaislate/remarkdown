<script lang="ts">
  import { toasts, dismissToast } from '../stores/toasts';
</script>

<div class="toasts" aria-live="polite" aria-label="Notifications">
  {#each $toasts as t (t.id)}
    <div class="toast {t.kind} glass" role="status">
      <span class="msg">{t.message}</span>
      <button class="dismiss" aria-label="Dismiss" onclick={() => dismissToast(t.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    top: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 200;
    max-width: 340px;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--fg-0);
    pointer-events: auto;
    animation: slideIn 0.22s ease-out;
  }
  .toast.info    { border-left: 3px solid var(--accent); }
  .toast.warning { border-left: 3px solid #f0a85a; }
  .toast.error   { border-left: 3px solid #ff6e6e; }
  .msg { flex: 1; line-height: 1.4; }
  .dismiss {
    background: transparent;
    border: 0;
    color: var(--fg-2);
    font-size: 18px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }
  .dismiss:hover { color: var(--fg-0); }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
</style>
