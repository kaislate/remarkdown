<script lang="ts">
  import ArrowLineLeft from 'phosphor-svelte/lib/ArrowLineLeft';
  import ArrowLineRight from 'phosphor-svelte/lib/ArrowLineRight';
  import BracketsAngle from 'phosphor-svelte/lib/BracketsAngle';
  import Trash from 'phosphor-svelte/lib/Trash';
  import type { Readable } from 'svelte/store';
  import type { NotePosition } from '../lib/editor/mermaid-sequence-graph';

  // Props are sourced from a Svelte store so the NodeView (plain TS,
  // outside any Svelte component context) can update them imperatively
  // by calling store.set(...). Same pattern as MermaidMessagePopover and
  // MermaidParticipantPopover.
  interface PopoverState {
    visible: boolean;
    x: number;
    y: number;
    text: string;
    position: NotePosition;
    primaryParticipant: string; // First participant (always present).
    secondaryParticipant: string; // '' when none.
    availableParticipants: string[]; // All participant ids in graph.
    onTextChange: (text: string) => void;
    onPositionChange: (position: NotePosition) => void;
    onSecondaryChange: (secondaryId: string) => void; // '' to clear.
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

  // Local draft for the text input — kept separate so typing doesn't
  // round-trip through the graph on every keystroke. Commit on blur or
  // Enter; reset on Escape.
  let textDraft: string = $state('');
  // Track which (visible, text) the draft was last seeded from so a
  // fresh open of the popover (or an external text change) re-seeds
  // the input.
  let lastSeed = '';
  $effect(() => {
    if (!current) return;
    const seed = `${current.visible ? 'v' : 'h'}::${current.text}`;
    if (seed !== lastSeed) {
      textDraft = current.text;
      lastSeed = seed;
    }
  });

  function commitText() {
    if (!current) return;
    if (textDraft !== current.text) current.onTextChange(textDraft);
  }

  function onKey(e: KeyboardEvent) {
    if (!current) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
      current.onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      textDraft = current.text;
      current.onClose();
    }
  }
</script>

{#if current}
  <div
    class="mermaid-note-popover glass"
    hidden={!current.visible}
    style="left: {current.x}px; top: {current.y}px;"
    role="dialog"
    aria-label="Edit note"
  >
    <input
      class="mermaid-note-popover-text"
      type="text"
      bind:value={textDraft}
      onblur={commitText}
      onkeydown={onKey}
      placeholder="Note text"
    />
    <div class="mermaid-note-position-row">
      <button type="button" class="mermaid-note-position-btn" class:active={current.position === 'leftOf'}
        title="Left of" aria-label="Left of"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onPositionChange('leftOf')}>
        <ArrowLineLeft size={14} />
      </button>
      <button type="button" class="mermaid-note-position-btn" class:active={current.position === 'rightOf'}
        title="Right of" aria-label="Right of"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onPositionChange('rightOf')}>
        <ArrowLineRight size={14} />
      </button>
      <button type="button" class="mermaid-note-position-btn" class:active={current.position === 'over'}
        title="Over" aria-label="Over"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onPositionChange('over')}>
        <BracketsAngle size={14} />
      </button>
    </div>
    {#if current.position === 'over'}
      <select
        class="mermaid-note-secondary-select"
        value={current.secondaryParticipant}
        onchange={(e) => current!.onSecondaryChange((e.currentTarget as HTMLSelectElement).value)}
        title="Span to (optional second participant)"
        aria-label="Second participant"
      >
        <option value="">(none)</option>
        {#each current.availableParticipants.filter((id) => id !== current!.primaryParticipant) as id}
          <option value={id}>{id}</option>
        {/each}
      </select>
    {/if}
    <button
      type="button"
      class="mermaid-note-popover-delete"
      title="Delete note"
      aria-label="Delete note"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => current!.onDelete()}
    >
      <Trash size={14} />
    </button>
  </div>
{/if}

<style>
  .mermaid-note-popover {
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
     the sibling popovers, since display:flex would otherwise win on
     specificity. */
  .mermaid-note-popover[hidden] { display: none; }
  .mermaid-note-popover-text {
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
  .mermaid-note-popover-text:focus { border-color: var(--accent); }
  .mermaid-note-position-row {
    display: flex;
    gap: 2px;
  }
  .mermaid-note-position-btn {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mermaid-note-position-btn:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .mermaid-note-position-btn.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .mermaid-note-secondary-select {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 11px;
    font-family: var(--font-sans);
    outline: none;
    cursor: pointer;
  }
  .mermaid-note-popover-delete {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mermaid-note-popover-delete:hover {
    background: var(--bg-2);
    color: var(--danger, #f0a0a0);
  }
</style>
