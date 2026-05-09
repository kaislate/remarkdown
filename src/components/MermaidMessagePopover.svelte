<script lang="ts">
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import Minus from 'phosphor-svelte/lib/Minus';
  import DotsThree from 'phosphor-svelte/lib/DotsThree';
  import ArrowFatRight from 'phosphor-svelte/lib/ArrowFatRight';
  import Trash from 'phosphor-svelte/lib/Trash';
  import type { Readable } from 'svelte/store';
  import type { MessageStyle } from '../lib/editor/mermaid-sequence-graph';

  // Props are sourced from a Svelte store so the NodeView (plain TS,
  // outside any Svelte component context) can update them imperatively
  // by calling store.set(...). Same pattern as MermaidEdgePopover and
  // MermaidParticipantPopover.
  interface PopoverState {
    visible: boolean;
    x: number;
    y: number;
    text: string;
    style: MessageStyle;
    onTextChange: (text: string) => void;
    onStyleChange: (style: MessageStyle) => void;
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
    class="mermaid-message-popover glass"
    hidden={!current.visible}
    style="left: {current.x}px; top: {current.y}px;"
    role="dialog"
    aria-label="Edit message"
  >
    <input
      class="mermaid-message-popover-text"
      type="text"
      bind:value={textDraft}
      onblur={commitText}
      onkeydown={onKey}
      placeholder="Message text (optional)"
    />
    <div class="mermaid-message-style-row">
      <button type="button" class="mermaid-message-style-btn" class:active={current.style === 'arrow'}
        title="Solid arrow" aria-label="Solid arrow"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onStyleChange('arrow')}>
        <ArrowRight size={14} />
      </button>
      <button type="button" class="mermaid-message-style-btn" class:active={current.style === 'solid'}
        title="Solid line, no head" aria-label="Solid line"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onStyleChange('solid')}>
        <Minus size={14} />
      </button>
      <button type="button" class="mermaid-message-style-btn" class:active={current.style === 'dotted'}
        title="Dotted line, no head" aria-label="Dotted line"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onStyleChange('dotted')}>
        <DotsThree size={14} />
      </button>
      <button type="button" class="mermaid-message-style-btn" class:active={current.style === 'reply'}
        title="Reply (dashed arrow)" aria-label="Reply"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onStyleChange('reply')}>
        <ArrowFatRight size={14} />
      </button>
    </div>
    <button
      type="button"
      class="mermaid-message-popover-delete"
      title="Delete message"
      aria-label="Delete message"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => current!.onDelete()}
    >
      <Trash size={14} />
    </button>
  </div>
{/if}

<style>
  .mermaid-message-popover {
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
  .mermaid-message-popover[hidden] { display: none; }
  .mermaid-message-popover-text {
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
  .mermaid-message-popover-text:focus { border-color: var(--accent); }
  .mermaid-message-style-row {
    display: flex;
    gap: 2px;
  }
  .mermaid-message-style-btn {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mermaid-message-style-btn:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .mermaid-message-style-btn.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .mermaid-message-popover-delete {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mermaid-message-popover-delete:hover {
    background: var(--bg-2);
    color: var(--danger, #f0a0a0);
  }
</style>
