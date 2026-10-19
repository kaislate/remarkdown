<script lang="ts">
  import { FILL_PALETTE } from '../lib/editor/mermaid/form';

  // A row of colour swatches plus "no colour" (the diagram's default).
  interface Props {
    value: string | null;
    palette?: string[];
    label?: string;
    onChange: (value: string | null) => void;
  }
  let { value, palette = FILL_PALETTE, label = 'Colour', onChange }: Props = $props();

  const norm = (c: string | null) => (c ?? '').toLowerCase();
</script>

<div class="mermaid-swatches" role="radiogroup" aria-label={label}>
  <button type="button" class="mermaid-swatch none" class:active={!value} role="radio" aria-checked={!value}
    title="Default" aria-label="Default colour"
    onmousedown={(e) => e.preventDefault()} onclick={() => onChange(null)}></button>
  {#each palette as colour (colour)}
    <button type="button" class="mermaid-swatch" class:active={norm(value) === norm(colour)} role="radio"
      aria-checked={norm(value) === norm(colour)} title={colour} aria-label={`Colour ${colour}`}
      style="background: {colour};"
      onmousedown={(e) => e.preventDefault()} onclick={() => onChange(colour)}></button>
  {/each}
</div>

<style>
  .mermaid-swatches { display: flex; gap: 3px; flex-wrap: wrap; }
  .mermaid-swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid var(--glass-border);
    padding: 0;
    cursor: pointer;
  }
  .mermaid-swatch.none {
    background: linear-gradient(135deg, transparent 45%, var(--fg-2) 45%, var(--fg-2) 55%, transparent 55%), var(--bg-2);
  }
  .mermaid-swatch.active { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
