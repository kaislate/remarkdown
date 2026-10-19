<script lang="ts">
  import type { Readable } from 'svelte/store';
  import type { ActionsBarState } from '../lib/editor/mermaid/form';
  import MermaidIcon from './MermaidIcon.svelte';

  // Floating per-diagram toolbar (top-right of the diagram): "+ Slice",
  // "+ Section", "Numbered", … — whatever the diagram's controller puts
  // in it (see mermaid/form.ts).
  interface Props {
    // See MermaidNodePopover for why this prop is `stateStore`.
    stateStore: Readable<ActionsBarState>;
  }
  let { stateStore }: Props = $props();

  let current: ActionsBarState | null = $state(null);
  $effect(() => {
    const unsub = stateStore.subscribe((v) => {
      current = v;
    });
    return unsub;
  });
</script>

{#if current}
  <div class="mermaid-actions-bar glass" class:left={current.align === 'left'} hidden={!current.visible} role="toolbar" aria-label={current.ariaLabel}>
    {#each current.items as item (item.id)}
      <button
        type="button"
        class="mermaid-action-btn"
        class:active={item.active}
        data-action={item.id}
        title={item.label}
        aria-label={item.label}
        aria-pressed={item.active === undefined ? undefined : item.active}
        disabled={item.disabled}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => item.onClick()}
      >
        {#if item.icon}<MermaidIcon name={item.icon} size={12} />{/if}
        <span>{item.label}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .mermaid-actions-bar {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    z-index: 40;
    pointer-events: auto;
    max-width: calc(100% - 16px);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .mermaid-actions-bar.left { right: auto; left: 8px; justify-content: flex-start; }
  .mermaid-actions-bar[hidden] { display: none; }
  .mermaid-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 3px 7px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 11px;
  }
  .mermaid-action-btn:hover { background: var(--bg-2); color: var(--fg-0); }
  .mermaid-action-btn.active { background: var(--accent-soft); color: var(--accent); }
  .mermaid-action-btn:disabled { opacity: 0.4; cursor: default; }
</style>
