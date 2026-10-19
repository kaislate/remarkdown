<script lang="ts">
  import Trash from 'phosphor-svelte/lib/Trash';
  import type { Readable } from 'svelte/store';
  import type { EdgeEnds, EdgeStroke } from '../lib/editor/mermaid-graph';
  import { parseRich, serializeRich, hasFormatting, richToPlain } from '../lib/editor/mermaid/rich-text';
  import { LINE_PALETTE } from '../lib/editor/mermaid/form';
  import MermaidRichText from './MermaidRichText.svelte';
  import MermaidLinkIcon from './MermaidLinkIcon.svelte';
  import MermaidSwatches from './MermaidSwatches.svelte';

  // Props are sourced from a Svelte store so the controller (plain TS,
  // outside any Svelte component context) can update them imperatively
  // by calling store.set(...). Same pattern as MermaidNodePopover.
  interface PopoverState {
    visible: boolean;
    x: number;
    y: number;
    label: string;
    markdown?: boolean;
    stroke: EdgeStroke;
    ends: EdgeEnds;
    color?: string | null;
    onLabelChange: (label: string, markdown: boolean) => void;
    onStrokeChange: (stroke: EdgeStroke) => void;
    onEndsChange: (ends: EdgeEnds) => void;
    onColorChange?: (value: string | null) => void;
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

  function seedValue(c: PopoverState | null): string {
    if (!c) return '';
    return c.markdown ? c.label : serializeRich([{ text: c.label, bold: false, italic: false }]);
  }
  const fieldValue = $derived(seedValue(current));

  function commitLabel(md: string) {
    if (!current) return;
    const runs = parseRich(md);
    const markdown = hasFormatting(runs);
    const label = markdown ? md : richToPlain(runs);
    if (label !== current.label || markdown !== !!current.markdown) current.onLabelChange(label, markdown);
  }

  const STROKES: Array<{ stroke: EdgeStroke; label: string }> = [
    { stroke: 'solid', label: 'Solid line' },
    { stroke: 'dotted', label: 'Dotted line' },
    { stroke: 'thick', label: 'Thick line' },
    { stroke: 'invisible', label: 'Invisible (keeps the layout, draws nothing)' },
  ];

  const ENDS: Array<{ ends: EdgeEnds; label: string }> = [
    { ends: 'arrow', label: 'Arrow' },
    { ends: 'none', label: 'No arrow' },
    { ends: 'circle', label: 'Circle end' },
    { ends: 'cross', label: 'Cross end' },
    { ends: 'both-arrow', label: 'Arrows both ways' },
    { ends: 'both-circle', label: 'Circles at both ends' },
    { ends: 'both-cross', label: 'Crosses at both ends' },
  ];
</script>

{#if current}
  <div
    class="mermaid-edge-popover glass"
    hidden={!current.visible}
    style="left: {current.x}px; top: {current.y}px;"
    role="dialog"
    aria-label="Edit edge"
  >
    <div class="mermaid-edge-row">
      <MermaidRichText
        value={fieldValue}
        className="mermaid-edge-popover-label"
        ariaLabel="Label"
        placeholder="Label (optional)"
        onCommit={commitLabel}
        onEnter={() => current!.onClose()}
        onEscape={() => current!.onClose()}
      />
      <button
        type="button"
        class="mermaid-edge-popover-delete"
        title="Delete connection"
        aria-label="Delete connection"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => current!.onDelete()}
      >
        <Trash size={14} />
      </button>
    </div>
    <div class="mermaid-edge-style-row" role="radiogroup" aria-label="Line">
      {#each STROKES as s (s.stroke)}
        <button type="button" class="mermaid-edge-style-btn" class:active={current.stroke === s.stroke}
          role="radio" aria-checked={current.stroke === s.stroke} title={s.label} aria-label={s.label}
          onmousedown={(e) => e.preventDefault()} onclick={() => current!.onStrokeChange(s.stroke)}>
          <MermaidLinkIcon stroke={s.stroke} ends="none" />
        </button>
      {/each}
    </div>
    {#if current.stroke !== 'invisible'}
      <div class="mermaid-edge-style-row" role="radiogroup" aria-label="Ends">
        {#each ENDS as e (e.ends)}
          <button type="button" class="mermaid-edge-style-btn" class:active={current.ends === e.ends}
            role="radio" aria-checked={current.ends === e.ends} title={e.label} aria-label={e.label}
            onmousedown={(ev) => ev.preventDefault()} onclick={() => current!.onEndsChange(e.ends)}>
            <MermaidLinkIcon ends={e.ends} />
          </button>
        {/each}
      </div>
      {#if current.onColorChange}
        <div class="mermaid-edge-row">
          <span class="mermaid-edge-row-label">Colour</span>
          <MermaidSwatches value={current.color ?? null} palette={LINE_PALETTE} label="Line colour"
            onChange={(v) => current!.onColorChange!(v)} />
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .mermaid-edge-popover {
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
    font-size: 11px;
    color: var(--fg-1);
  }
  /* Re-assert display:none for the [hidden] attribute — same trick as
     MermaidNodePopover, since .mermaid-edge-popover's display:flex
     would otherwise win on specificity. */
  .mermaid-edge-popover[hidden] { display: none; }
  .mermaid-edge-row { display: flex; align-items: center; gap: 6px; }
  .mermaid-edge-row-label { color: var(--fg-2); min-width: 40px; }
  .mermaid-edge-popover-delete {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mermaid-edge-popover-delete:hover {
    background: var(--bg-2);
    color: var(--danger, #f0a0a0);
  }
  .mermaid-edge-style-row {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
  }
  .mermaid-edge-style-btn {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 5px;
    border-radius: 4px;
    cursor: pointer;
  }
  .mermaid-edge-style-btn:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .mermaid-edge-style-btn.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
