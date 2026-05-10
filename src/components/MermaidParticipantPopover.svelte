<script lang="ts">
  import Trash from 'phosphor-svelte/lib/Trash';
  import type { Readable } from 'svelte/store';

  // Props are sourced from a Svelte store so the NodeView (plain TS,
  // outside any Svelte component context) can update them imperatively
  // by calling store.set(...). Same pattern as MermaidEdgePopover and
  // MermaidNodePopover.
  interface PopoverState {
    visible: boolean;
    x: number;
    y: number;
    display: string;
    onDisplayChange: (display: string) => void;
    onDelete: () => void;
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
  // bindings re-run on store updates.
  let current: PopoverState | null = $state(null);
  $effect(() => {
    const unsub = stateStore.subscribe((v) => {
      current = v;
    });
    return unsub;
  });

  // Local draft for the display input — kept separate so typing doesn't
  // round-trip through the graph on every keystroke. Commit on blur or
  // Enter; reset on Escape.
  let displayDraft: string = $state('');
  // Track which (visible, display) the draft was last seeded from so a
  // fresh open of the popover (or an external display change) re-seeds
  // the input.
  let lastSeed = '';
  $effect(() => {
    if (!current) return;
    const seed = `${current.visible ? 'v' : 'h'}::${current.display}`;
    if (seed !== lastSeed) {
      displayDraft = current.display;
      lastSeed = seed;
    }
  });

  function commitDisplay() {
    if (!current) return;
    if (displayDraft !== current.display) current.onDisplayChange(displayDraft);
  }

  function onKey(e: KeyboardEvent) {
    if (!current) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDisplay();
      current.onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      displayDraft = current.display;
      current.onClose();
    }
  }
</script>

{#if current}
  <div
    class="mermaid-participant-popover glass"
    hidden={!current.visible}
    style="left: {current.x}px; top: {current.y}px;"
    role="dialog"
    aria-label="Edit participant"
  >
    <input
      class="mermaid-participant-popover-display"
      type="text"
      bind:value={displayDraft}
      onblur={commitDisplay}
      onkeydown={onKey}
      placeholder="Display name (optional)"
    />
    <button
      type="button"
      class="mermaid-participant-popover-delete"
      title="Delete participant"
      aria-label="Delete participant"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => current!.onDelete()}
    >
      <Trash size={14} />
    </button>
  </div>
{/if}

<style>
  .mermaid-participant-popover {
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
     MermaidNodePopover / MermaidEdgePopover, since the popover's
     display:flex would otherwise win on specificity. */
  .mermaid-participant-popover[hidden] { display: none; }
  .mermaid-participant-popover-display {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    font-family: var(--font-sans);
    width: 180px;
    outline: none;
  }
  .mermaid-participant-popover-display:focus { border-color: var(--accent); }
  .mermaid-participant-popover-delete {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mermaid-participant-popover-delete:hover {
    background: var(--bg-2);
    color: var(--danger, #f0a0a0);
  }
</style>
