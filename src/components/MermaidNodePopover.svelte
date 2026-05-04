<script lang="ts">
  import Square from 'phosphor-svelte/lib/Square';
  import Rectangle from 'phosphor-svelte/lib/Rectangle';
  import Circle from 'phosphor-svelte/lib/Circle';
  import Diamond from 'phosphor-svelte/lib/Diamond';
  import Trash from 'phosphor-svelte/lib/Trash';
  import Plus from 'phosphor-svelte/lib/Plus';
  import type { Readable } from 'svelte/store';

  type Shape = 'rect' | 'rounded' | 'circle' | 'diamond';

  // Props are sourced from a Svelte store so the NodeView (plain TS,
  // outside any Svelte component context) can update them imperatively
  // by calling store.set(...). The component subscribes via $state
  // sync below so the DOM tracks every store change.
  interface PopoverState {
    visible: boolean;
    x: number;
    y: number;
    label: string;
    shape: Shape;
    onLabelChange: (label: string) => void;
    onShapeChange: (shape: Shape) => void;
    onDelete: () => void;
    onAddConnection: () => void;
    onClose: () => void;
  }

  interface Props {
    // NOTE: do not name this prop `state` — Svelte's legacy store
    // auto-subscribe syntax (`$state` -> auto-subscribed value of a
    // store named `state`) collides with the `$state` rune and the
    // compiler will rewrite our rune calls into store-accessor calls.
    // `stateStore` keeps both the prop and the rune unambiguous.
    stateStore: Readable<PopoverState>;
  }
  let { stateStore }: Props = $props();

  // Mirror the store value into local reactive state so all template
  // bindings re-run on store updates. $effect fires whenever the store
  // pushes a new value.
  let current: PopoverState | null = $state(null);
  $effect(() => {
    const unsub = stateStore.subscribe((v) => {
      current = v;
    });
    return unsub;
  });

  // Local draft for the label input — kept separate so typing doesn't
  // round-trip through the graph on every keystroke. Commit on blur or
  // Enter; reset on Escape.
  let labelDraft: string = $state('');
  // Track which (visible, label) the draft was last seeded from so that
  // a fresh open of the popover (or a label change from outside) re-seeds
  // the input.
  let lastSeed = '';
  $effect(() => {
    if (!current) return;
    const seed = `${current.visible ? 'v' : 'h'}::${current.label}`;
    if (seed !== lastSeed) {
      labelDraft = current.label;
      lastSeed = seed;
    }
  });

  function commitLabel() {
    if (!current) return;
    if (labelDraft !== current.label) current.onLabelChange(labelDraft);
  }

  function onKey(e: KeyboardEvent) {
    if (!current) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitLabel();
      current.onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      labelDraft = current.label;
      current.onClose();
    }
  }
</script>

{#if current}
  <div
    class="mermaid-popover glass"
    hidden={!current.visible}
    style="left: {current.x}px; top: {current.y}px;"
    role="dialog"
    aria-label="Edit node"
  >
    <input
      class="mermaid-popover-label"
      type="text"
      bind:value={labelDraft}
      onblur={commitLabel}
      onkeydown={onKey}
      placeholder="Label"
    />
    <div class="mermaid-popover-shapes">
      <button type="button" class="mermaid-shape-btn" class:active={current.shape === 'rect'}
        title="Rectangle" aria-label="Rectangle"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onShapeChange('rect')}>
        <Square size={14} />
      </button>
      <button type="button" class="mermaid-shape-btn" class:active={current.shape === 'rounded'}
        title="Rounded" aria-label="Rounded"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onShapeChange('rounded')}>
        <Rectangle size={14} />
      </button>
      <button type="button" class="mermaid-shape-btn" class:active={current.shape === 'circle'}
        title="Circle" aria-label="Circle"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onShapeChange('circle')}>
        <Circle size={14} />
      </button>
      <button type="button" class="mermaid-shape-btn" class:active={current.shape === 'diamond'}
        title="Diamond" aria-label="Diamond"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onShapeChange('diamond')}>
        <Diamond size={14} />
      </button>
    </div>
    <button type="button" class="mermaid-popover-action"
      title="Add connection" aria-label="Add connection"
      onmousedown={(e) => e.preventDefault()} onclick={() => current!.onAddConnection()}>
      <Plus size={14} />
      <span>connect</span>
    </button>
    <button type="button" class="mermaid-popover-action mermaid-popover-delete"
      title="Delete node" aria-label="Delete node"
      onmousedown={(e) => e.preventDefault()} onclick={() => current!.onDelete()}>
      <Trash size={14} />
    </button>
  </div>
{/if}

<style>
  .mermaid-popover {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    z-index: 60;
    pointer-events: auto;
  }
  /* Re-assert display:none for the [hidden] attribute — same trick as
     EditorBubbleMenu / TableActionsMenu, since .mermaid-popover's
     display:flex would otherwise win on specificity. */
  .mermaid-popover[hidden] { display: none; }
  .mermaid-popover-label {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    font-family: var(--font-sans);
    width: 160px;
    outline: none;
  }
  .mermaid-popover-label:focus { border-color: var(--accent); }
  .mermaid-popover-shapes { display: flex; gap: 2px; }
  .mermaid-shape-btn, .mermaid-popover-action {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 11px;
  }
  .mermaid-shape-btn:hover, .mermaid-popover-action:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .mermaid-shape-btn.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .mermaid-popover-delete:hover { color: var(--danger, #f0a0a0); }
</style>
