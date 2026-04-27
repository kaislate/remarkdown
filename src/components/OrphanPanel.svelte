<script lang="ts">
  import { activeModal, closeModal } from '../stores/modals';
  import { orphanedAnnots, removeAnnotation } from '../stores/annots';
  import { startReattach } from '../stores/reattach';
  import type { Annotation } from '../lib/schema';

  function excerpt(a: Annotation): string {
    if (a.type === 'drawing') return `[drawing — ${a.shape.kind}]`;
    return a.anchor.text;
  }

  function blockInfo(a: Annotation): string {
    if (a.type === 'drawing') {
      const s = a.shape;
      if (s.kind === 'freehand-legacy') return s.anchorBlock;
      if ('anchor' in s && 'blockId' in s.anchor) return s.anchor.blockId;
      if ('anchor' in s && 'blockHint' in s.anchor) return s.anchor.blockHint;
      return '';
    }
    return a.anchor.blockHint;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && $activeModal?.kind === 'orphans') closeModal();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if $activeModal?.kind === 'orphans'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="scrim" onclick={closeModal} role="presentation">
    <div class="orphan-panel glass" role="dialog" aria-modal="true" aria-label="Orphaned annotations" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <header>
        <h2>Orphaned annotations</h2>
        <button class="close" aria-label="Close" onclick={closeModal}>×</button>
      </header>
      {#if $orphanedAnnots.length === 0}
        <p class="empty">No orphaned annotations. All your re.marks are attached.</p>
      {:else}
        <ul>
          {#each $orphanedAnnots as a (a.id)}
            <li>
              <div class="meta">
                <span class="kind">{a.type}</span>
                <span class="block">{blockInfo(a)}</span>
                <span class="date">{new Date(a.createdAt).toLocaleDateString()}</span>
              </div>
              <div class="text">{excerpt(a)}</div>
              <div class="actions">
                <button class="reattach" onclick={() => {
                  startReattach({
                    annotationId: a.id,
                    snippet: excerpt(a).slice(0, 60),
                    kind: a.type === 'drawing' ? a.shape.kind : undefined,
                  });
                  closeModal();
                }}>Re-attach</button>
                <button onclick={() => removeAnnotation(a.id)}>Delete</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
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
    backdrop-filter: blur(2px);
  }
  .orphan-panel {
    width: min(520px, 90vw);
    max-height: 80vh;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  header h2 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--fg-0);
  }
  .close {
    background: transparent;
    border: 0;
    color: var(--fg-2);
    font-size: 20px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .close:hover { color: var(--fg-0); }
  .empty {
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 13px;
    text-align: center;
    padding: 20px 0;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    padding: 10px 12px;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .meta {
    display: flex;
    gap: 10px;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--fg-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .text {
    font-family: var(--font-serif);
    font-size: 14px;
    color: var(--fg-1);
  }
  .actions { display: flex; justify-content: flex-end; }
  .actions button {
    background: transparent;
    border: 1px solid var(--glass-border);
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .actions button:hover { color: #ff8080; border-color: #ff8080; }
  .actions .reattach {
    background: var(--accent-soft);
    color: var(--accent);
    border: 0;
  }
  .actions .reattach:hover { filter: brightness(1.15); }
</style>
