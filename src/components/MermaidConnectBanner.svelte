<script lang="ts">
  import Plus from 'phosphor-svelte/lib/Plus';
  import type { Readable } from 'svelte/store';

  // The banner is shown while the NodeView is in connect-mode (after the
  // user clicks "+ connect" on a node popover). It's a thin Svelte
  // surface — all state lives in the NodeView and is pushed in via a
  // store, just like the node + edge popovers (Tasks 5, 6).
  interface BannerState {
    visible: boolean;
    onAddNewNode: () => void;
    onCancel: () => void;
  }

  interface Props {
    // See MermaidNodePopover for why this prop is `stateStore` and not
    // `state` — the legacy auto-subscribe syntax would collide with the
    // `$state` rune.
    stateStore: Readable<BannerState>;
  }
  let { stateStore }: Props = $props();

  let current: BannerState | null = $state(null);
  $effect(() => {
    const unsub = stateStore.subscribe((v) => {
      current = v;
    });
    return unsub;
  });
</script>

{#if current}
  <div
    class="mermaid-connect-banner glass"
    hidden={!current.visible}
    role="status"
    aria-label="Connect mode active"
  >
    <span class="mermaid-connect-hint">Click a node to connect</span>
    <button
      type="button"
      class="mermaid-connect-add-new"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => current!.onAddNewNode()}
    >
      <Plus size={14} />
      <span>Add new node</span>
    </button>
    <button
      type="button"
      class="mermaid-connect-cancel"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => current!.onCancel()}
      title="Esc to cancel"
      aria-label="Cancel"
    >
      Cancel
    </button>
  </div>
{/if}

<style>
  .mermaid-connect-banner {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: var(--bg-1);
    border: 1px solid var(--accent-soft);
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    z-index: 70;
    pointer-events: auto;
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--fg-1);
    white-space: nowrap;
  }
  .mermaid-connect-banner[hidden] { display: none; }
  .mermaid-connect-hint {
    color: var(--fg-2);
  }
  .mermaid-connect-add-new {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--accent-soft);
    color: var(--accent);
    border: 0;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .mermaid-connect-add-new:hover {
    background: var(--accent);
    color: var(--bg-0);
  }
  .mermaid-connect-cancel {
    background: transparent;
    color: var(--fg-2);
    border: 0;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .mermaid-connect-cancel:hover {
    color: var(--fg-0);
  }
</style>
