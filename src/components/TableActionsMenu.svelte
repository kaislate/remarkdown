<script lang="ts">
  import RowsPlusBottom from 'phosphor-svelte/lib/RowsPlusBottom';
  import ColumnsPlusRight from 'phosphor-svelte/lib/ColumnsPlusRight';
  import Minus from 'phosphor-svelte/lib/Minus';

  interface Props {
    visible: boolean;
    x: number;
    y: number;
    onAddRow: () => void;
    onAddCol: () => void;
    onDelRow: () => void;
    onDelCol: () => void;
  }
  let { visible, x, y, onAddRow, onAddCol, onDelRow, onDelCol }: Props = $props();
</script>

<div
  class="table-actions-menu glass"
  hidden={!visible}
  style="left: {x}px; top: {y}px;"
  role="toolbar"
  aria-label="Table actions"
>
  <button
    type="button"
    class="table-action-btn"
    title="Add row below"
    aria-label="Add row below"
    onmousedown={(e) => e.preventDefault()}
    onclick={onAddRow}
  >
    <RowsPlusBottom size={16} />
  </button>
  <button
    type="button"
    class="table-action-btn"
    title="Add column right"
    aria-label="Add column right"
    onmousedown={(e) => e.preventDefault()}
    onclick={onAddCol}
  >
    <ColumnsPlusRight size={16} />
  </button>
  <button
    type="button"
    class="table-action-btn"
    title="Delete current row"
    aria-label="Delete current row"
    onmousedown={(e) => e.preventDefault()}
    onclick={onDelRow}
  >
    <Minus size={16} />
    <span class="hint">row</span>
  </button>
  <button
    type="button"
    class="table-action-btn"
    title="Delete current column"
    aria-label="Delete current column"
    onmousedown={(e) => e.preventDefault()}
    onclick={onDelCol}
  >
    <Minus size={16} />
    <span class="hint">col</span>
  </button>
</div>

<style>
  .table-actions-menu {
    position: absolute;
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    z-index: 50;
    pointer-events: auto;
    /* Centered above the anchor point: -50% pulls the menu's left
       edge back to its midpoint, calc(-100% - 8px) lifts it above
       the anchor with 8px breathing room. Mirrors EditorBubbleMenu. */
    transform: translate(-50%, calc(-100% - 8px));
  }
  /* Re-assert display:none for the [hidden] attribute — the .table-actions-menu
     selector's display:flex would otherwise win on specificity. Same
     trick as EditorBubbleMenu so the menu stays mounted (icons keep
     their state) while invisible. */
  .table-actions-menu[hidden] {
    display: none;
  }
  .table-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 11px;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .table-action-btn:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }
  .hint {
    color: var(--fg-2);
  }
</style>
