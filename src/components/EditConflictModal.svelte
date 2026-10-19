<script lang="ts">
  // Shown when edit-mode autosave finds that another program changed the
  // file. Saving for that tab is paused until the user chooses, so the
  // dialog can't be dismissed without a choice (no Esc, no scrim click).
  import { get } from 'svelte/store';
  import { activeModal } from '../stores/modals';
  import { sessions } from '../stores/sessions';
  import { resolveEditConflict, type ConflictChoice } from '../lib/edit-save';

  const session = $derived.by(() => {
    const m = $activeModal;
    if (m?.kind !== 'edit-conflict') return null;
    return $sessions.find((s) => s.id === m.sessionId) ?? null;
  });

  const name = $derived.by(() => {
    if (!session) return '';
    const path = get(session.doc)?.path ?? '';
    const base = path.split(/[\\/]/).pop() ?? path;
    return base.replace(/\.(md|markdown)$/i, '');
  });

  let busy = $state(false);

  async function choose(choice: ConflictChoice) {
    if (!session || busy) return;
    busy = true;
    try {
      await resolveEditConflict(session, choice);
    } finally {
      busy = false;
    }
  }
</script>

{#if session}
  <div class="scrim" role="presentation">
    <div
      class="confirm-panel glass"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="edit-conflict-title"
      aria-describedby="edit-conflict-desc"
    >
      <h2 id="edit-conflict-title">“{name}” was changed by another program</h2>
      <p id="edit-conflict-desc">
        Someone or something else saved this document while you were editing it.
        Your latest changes haven't been saved yet. Which version do you want?
      </p>
      <div class="actions">
        <button disabled={busy} onclick={() => choose('copy')}>Save mine as a copy</button>
        <button disabled={busy} onclick={() => choose('theirs')}>Use the other version</button>
        <button class="primary" disabled={busy} onclick={() => choose('keep')}>Keep my version</button>
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
    width: min(460px, 90vw);
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
  .actions {
    display: flex;
    flex-wrap: wrap;
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
  .actions button:disabled { opacity: 0.5; cursor: default; }
  .actions .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .actions .primary:hover { color: #fff; filter: brightness(1.08); }
</style>
