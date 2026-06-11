<script lang="ts">
  import ArrowDown from 'phosphor-svelte/lib/ArrowDown';
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
  import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
  import type { Readable } from 'svelte/store';
  import type { MermaidDirection } from '../lib/editor/mermaid-graph';

  // Floating direction picker for flowcharts. Exposes mermaid's four
  // layout directions; the NodeView wires onDirectionChange back
  // through setDirection → serialize → PM commit. Same store-backed
  // pattern as MermaidSequenceActions.
  interface DirectionState {
    visible: boolean;
    direction: MermaidDirection;
    onDirectionChange: (direction: MermaidDirection) => void;
  }

  interface Props {
    // See MermaidNodePopover for why this prop is `stateStore` and not
    // `state` — the legacy auto-subscribe syntax would collide with the
    // `$state` rune.
    stateStore: Readable<DirectionState>;
  }
  let { stateStore }: Props = $props();

  // Mirror the store value into local reactive state so all template
  // bindings re-run on store updates.
  let current: DirectionState | null = $state(null);
  $effect(() => {
    const unsub = stateStore.subscribe((v) => {
      current = v;
    });
    return unsub;
  });

  const OPTIONS: Array<{
    direction: MermaidDirection;
    label: string;
    icon: typeof ArrowDown;
  }> = [
    { direction: 'TD', label: 'Top to bottom', icon: ArrowDown },
    { direction: 'LR', label: 'Left to right', icon: ArrowRight },
    { direction: 'BT', label: 'Bottom to top', icon: ArrowUp },
    { direction: 'RL', label: 'Right to left', icon: ArrowLeft },
  ];
</script>

{#if current}
  <div
    class="mermaid-direction-picker glass"
    hidden={!current.visible}
    role="toolbar"
    aria-label="Flowchart direction"
  >
    {#each OPTIONS as opt (opt.direction)}
      <button
        type="button"
        class="mermaid-direction-btn"
        class:active={current.direction === opt.direction}
        title={opt.label}
        aria-label={opt.label}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => current!.onDirectionChange(opt.direction)}
      >
        <opt.icon size={12} />
      </button>
    {/each}
  </div>
{/if}

<style>
  .mermaid-direction-picker {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    z-index: 40;
    pointer-events: auto;
  }
  /* Re-assert display:none for the [hidden] attribute — same trick as
     the popovers, since display:flex would otherwise win on specificity. */
  .mermaid-direction-picker[hidden] {
    display: none;
  }
  .mermaid-direction-btn {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mermaid-direction-btn:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .mermaid-direction-btn.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
