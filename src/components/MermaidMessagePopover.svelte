<script lang="ts">
  import Trash from 'phosphor-svelte/lib/Trash';
  import Plus from 'phosphor-svelte/lib/Plus';
  import type { Readable } from 'svelte/store';
  import type { BlockKind, MessageStyle } from '../lib/editor/mermaid-sequence-graph';
  import MermaidSeqArrowIcon from './MermaidSeqArrowIcon.svelte';

  type PickableStyle = Exclude<MessageStyle, 'other'>;

  // Props are sourced from a Svelte store so the controller (plain TS,
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
    onStyleChange: (style: PickableStyle) => void;
    onDelete: () => void;
    // "+ after" button — adds a new message right below the current one
    // with the same style and empty text, then opens the new message's
    // popover so the user can type immediately.
    onAddAfter: () => void;
    onClose: () => void;
    // The activity bar this message starts on its receiver / ends on its
    // sender ("activation" to mermaid).
    activation?: 'activate' | 'deactivate' | null;
    // Ending the sender's bar is only possible while it has one.
    canDeactivate?: boolean;
    onActivationChange?: (activation: 'activate' | 'deactivate' | null) => void;
    // Wrap the message (or the selected run) in a block.
    onWrap?: (kind: BlockKind) => void;
    // The block it sits in, when there is one.
    blockLabel?: string | null;
    onEditBlock?: () => void;
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

  const STYLES: Array<{ style: PickableStyle; label: string }> = [
    { style: 'arrow', label: 'Solid arrow' },
    { style: 'reply', label: 'Reply (dashed arrow)' },
    { style: 'solid', label: 'Solid line' },
    { style: 'dotted', label: 'Dotted line' },
    { style: 'cross', label: 'Solid, crossed end (lost / cancelled)' },
    { style: 'dottedCross', label: 'Dashed, crossed end' },
    { style: 'async', label: 'Solid, open arrow (no wait for a reply)' },
    { style: 'dottedAsync', label: 'Dashed, open arrow' },
    { style: 'both', label: 'Both ways' },
    { style: 'dottedBoth', label: 'Both ways, dashed' },
  ];

  const BLOCKS: Array<{ kind: BlockKind; label: string }> = [
    { kind: 'loop', label: 'Repeat (loop)' },
    { kind: 'alt', label: 'Either / or' },
    { kind: 'opt', label: 'Optional' },
    { kind: 'par', label: 'At the same time' },
    { kind: 'critical', label: 'Critical' },
    { kind: 'break', label: 'Stop here (break)' },
    { kind: 'rect', label: 'Highlight' },
  ];
</script>

{#if current}
  <div
    class="mermaid-message-popover glass"
    hidden={!current.visible}
    style="left: {current.x}px; top: {current.y}px;"
    role="dialog"
    aria-label="Edit message"
  >
    <div class="mermaid-message-row">
      <input
        class="mermaid-message-popover-text"
        type="text"
        bind:value={textDraft}
        onblur={commitText}
        onkeydown={onKey}
        placeholder="Message text (optional)"
      />
      <button
        type="button"
        class="mermaid-message-popover-add-after"
        title="Add message after"
        aria-label="Add message after"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => { commitText(); current!.onAddAfter(); }}
      >
        <Plus size={14} />
        <span>after</span>
      </button>
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
    <div class="mermaid-message-style-row" role="radiogroup" aria-label="Arrow">
      {#each STYLES as s (s.style)}
        <button type="button" class="mermaid-message-style-btn" class:active={current.style === s.style}
          role="radio" aria-checked={current.style === s.style} title={s.label} aria-label={s.label}
          onmousedown={(e) => e.preventDefault()} onclick={() => current!.onStyleChange(s.style)}>
          <MermaidSeqArrowIcon style={s.style} />
        </button>
      {/each}
    </div>
    {#if current.onActivationChange || current.onWrap}
      <div class="mermaid-message-row">
        {#if current.onActivationChange}
          <select class="mermaid-message-select" aria-label="Activity bar" value={current.activation ?? ''}
            onchange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              current!.onActivationChange!(v === '' ? null : (v as 'activate' | 'deactivate'));
            }}>
            <option value="">No activity bar change</option>
            <option value="activate">Receiver starts working</option>
            <option value="deactivate" disabled={!current.canDeactivate && current.activation !== 'deactivate'}>Sender stops working</option>
          </select>
        {/if}
        {#if current.onWrap}
          <select class="mermaid-message-select" aria-label="Put in a block" value=""
            onchange={(e) => {
              const el = e.target as HTMLSelectElement;
              const v = el.value;
              el.value = '';
              if (v) current!.onWrap!(v as BlockKind);
            }}>
            <option value="">Put in a block…</option>
            {#each BLOCKS as b (b.kind)}<option value={b.kind}>{b.label}</option>{/each}
          </select>
        {/if}
        {#if current.blockLabel && current.onEditBlock}
          <button type="button" class="mermaid-message-popover-add-after" title="Edit the block it's in" aria-label="Edit block"
            onmousedown={(e) => e.preventDefault()} onclick={() => current!.onEditBlock!()}>
            <span>In: {current.blockLabel}</span>
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .mermaid-message-popover {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 6px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    z-index: 60;
    pointer-events: auto;
    font-family: var(--font-sans);
  }
  /* Re-assert display:none for the [hidden] attribute — same trick as
     the sibling popovers, since display:flex would otherwise win on
     specificity. */
  .mermaid-message-popover[hidden] { display: none; }
  .mermaid-message-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
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
    gap: 1px;
    flex-wrap: wrap;
    max-width: 300px;
  }
  .mermaid-message-style-btn {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 5px;
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
  .mermaid-message-select {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
    font-family: var(--font-sans);
  }
  .mermaid-message-popover-add-after {
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
  .mermaid-message-popover-add-after:hover {
    background: var(--bg-2);
    color: var(--fg-0);
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
