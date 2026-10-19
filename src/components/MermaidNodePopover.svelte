<script lang="ts">
  import Trash from 'phosphor-svelte/lib/Trash';
  import Plus from 'phosphor-svelte/lib/Plus';
  import Palette from 'phosphor-svelte/lib/Palette';
  import type { Readable } from 'svelte/store';
  import type { MermaidShape } from '../lib/editor/mermaid-graph';
  import { parseRich, serializeRich, hasFormatting, richToPlain } from '../lib/editor/mermaid/rich-text';
  import { FILL_PALETTE, LINE_PALETTE, NEW_GROUP } from '../lib/editor/mermaid/form';
  import MermaidRichText from './MermaidRichText.svelte';
  import MermaidShapeIcon from './MermaidShapeIcon.svelte';
  import MermaidSwatches from './MermaidSwatches.svelte';

  type ColorProp = 'fill' | 'stroke' | 'color';

  // Props are sourced from a Svelte store so the controller (plain TS,
  // outside any Svelte component context) can update them imperatively
  // by calling store.set(...). The component subscribes via $state
  // sync below so the DOM tracks every store change.
  interface PopoverState {
    visible: boolean;
    x: number;
    y: number;
    label: string;
    // The label is a markdown string (bold / italic); `label` is then
    // its markdown.
    markdown?: boolean;
    shape: MermaidShape;
    // Groups the node can be put in, and the one it's in.
    groups?: Array<{ id: string; title: string }>;
    group?: string | null;
    colors?: Partial<Record<ColorProp, string | null>>;
    onLabelChange: (label: string, markdown: boolean) => void;
    onShapeChange: (shape: MermaidShape) => void;
    // A group id, null for none, or NEW_GROUP.
    onGroupChange?: (group: string | null) => void;
    onColorChange?: (prop: ColorProp, value: string | null) => void;
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

  let current: PopoverState | null = $state(null);
  $effect(() => {
    const unsub = stateStore.subscribe((v) => {
      current = v;
    });
    return unsub;
  });

  let showColors = $state(false);
  // A fresh open starts with the colours folded away.
  let lastKey = '';
  $effect(() => {
    const key = current?.visible ? `${current.x},${current.y}` : '';
    if (key !== lastKey && !current?.visible) showColors = false;
    lastKey = key;
  });

  // The rich field reads markdown: a plain label's own asterisks are
  // escaped so they show as typed.
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

  const SHAPES: Array<{ shape: MermaidShape; label: string }> = [
    { shape: 'rect', label: 'Rectangle' },
    { shape: 'rounded', label: 'Rounded' },
    { shape: 'stadium', label: 'Stadium' },
    { shape: 'subroutine', label: 'Subroutine' },
    { shape: 'cylinder', label: 'Database' },
    { shape: 'circle', label: 'Circle' },
    { shape: 'doubleCircle', label: 'Double circle' },
    { shape: 'asymmetric', label: 'Flag' },
    { shape: 'diamond', label: 'Diamond' },
    { shape: 'hexagon', label: 'Hexagon' },
    { shape: 'parallelogram', label: 'Parallelogram' },
    { shape: 'parallelogramAlt', label: 'Parallelogram (left)' },
    { shape: 'trapezoid', label: 'Trapezoid' },
    { shape: 'trapezoidAlt', label: 'Trapezoid (upside down)' },
  ];

  const COLORS: Array<{ prop: ColorProp; label: string; palette: string[] }> = [
    { prop: 'fill', label: 'Fill', palette: FILL_PALETTE },
    { prop: 'stroke', label: 'Border', palette: LINE_PALETTE },
    { prop: 'color', label: 'Text', palette: LINE_PALETTE },
  ];
</script>

{#if current}
  <div
    class="mermaid-popover glass"
    hidden={!current.visible}
    style="left: {current.x}px; top: {current.y}px;"
    role="dialog"
    aria-label="Edit node"
  >
    <div class="mermaid-popover-row">
      <MermaidRichText
        value={fieldValue}
        className="mermaid-popover-label"
        ariaLabel="Label"
        placeholder="Label"
        multiline
        onCommit={commitLabel}
        onEnter={() => current!.onClose()}
        onEscape={() => current!.onClose()}
      />
      <button type="button" class="mermaid-popover-action"
        title="Add connection" aria-label="Add connection"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onAddConnection()}>
        <Plus size={14} />
        <span>connect</span>
      </button>
      {#if current.onColorChange}
        <button type="button" class="mermaid-popover-action" class:active={showColors}
          title="Colours" aria-label="Colours" aria-expanded={showColors}
          onmousedown={(e) => e.preventDefault()} onclick={() => (showColors = !showColors)}>
          <Palette size={14} />
        </button>
      {/if}
      <button type="button" class="mermaid-popover-action mermaid-popover-delete"
        title="Delete node" aria-label="Delete node"
        onmousedown={(e) => e.preventDefault()} onclick={() => current!.onDelete()}>
        <Trash size={14} />
      </button>
    </div>
    <div class="mermaid-popover-shapes" role="radiogroup" aria-label="Shape">
      {#each SHAPES as s (s.shape)}
        <button type="button" class="mermaid-shape-btn" class:active={current.shape === s.shape}
          role="radio" aria-checked={current.shape === s.shape} title={s.label} aria-label={s.label}
          onmousedown={(e) => e.preventDefault()} onclick={() => current!.onShapeChange(s.shape)}>
          <MermaidShapeIcon shape={s.shape} size={15} />
        </button>
      {/each}
    </div>
    {#if current.onGroupChange && current.groups}
      <label class="mermaid-popover-row mermaid-popover-group">
        <span>Group</span>
        <select aria-label="Group" value={current.group ?? ''}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            current!.onGroupChange!(v === '' ? null : v);
          }}>
          <option value="">No group</option>
          {#each current.groups as g (g.id)}
            <option value={g.id}>{g.title || 'Untitled group'}</option>
          {/each}
          <option value={NEW_GROUP}>New group…</option>
        </select>
      </label>
    {/if}
    {#if showColors && current.onColorChange}
      {#each COLORS as c (c.prop)}
        <div class="mermaid-popover-row mermaid-popover-colors">
          <span>{c.label}</span>
          <MermaidSwatches value={current.colors?.[c.prop] ?? null} palette={c.palette} label={`${c.label} colour`}
            onChange={(v) => current!.onColorChange!(c.prop, v)} />
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .mermaid-popover {
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
     EditorBubbleMenu / TableActionsMenu, since .mermaid-popover's
     display:flex would otherwise win on specificity. */
  .mermaid-popover[hidden] { display: none; }
  .mermaid-popover-row { display: flex; align-items: center; gap: 6px; }
  .mermaid-popover-shapes { display: flex; gap: 1px; flex-wrap: wrap; max-width: 300px; }
  .mermaid-shape-btn, .mermaid-popover-action {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 5px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 11px;
  }
  .mermaid-shape-btn:hover, .mermaid-popover-action:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .mermaid-shape-btn.active, .mermaid-popover-action.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .mermaid-popover-delete:hover { color: var(--danger, #f0a0a0); }
  .mermaid-popover-group select {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
    font-family: var(--font-sans);
  }
  .mermaid-popover-group > span, .mermaid-popover-colors > span { min-width: 40px; color: var(--fg-2); }
</style>
