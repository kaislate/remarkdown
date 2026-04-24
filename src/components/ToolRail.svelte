<script lang="ts">
  import { tool, setMode } from '../stores/tool';
  import type { Tool } from '../lib/schema';

  const TOOLS: { mode: Tool; label: string; glyph: string }[] = [
    { mode: 'cursor', label: 'Cursor', glyph: '↖' },
    { mode: 'highlight', label: 'Highlight', glyph: '▬' },
    { mode: 'note', label: 'Note', glyph: '✎' },
    { mode: 'draw', label: 'Draw', glyph: '✏' },
    { mode: 'eraser', label: 'Eraser', glyph: '⌫' },
  ];
</script>

<div class="rail glass glass-pill" role="radiogroup" aria-label="Annotation tool">
  {#each TOOLS as t (t.mode)}
    <button
      class="btn"
      role="radio"
      aria-checked={$tool.mode === t.mode}
      aria-label={t.label}
      onclick={() => setMode(t.mode)}
    >
      <span class="glyph" aria-hidden="true">{t.glyph}</span>
    </button>
  {/each}
</div>

<style>
  .rail {
    position: fixed;
    bottom: 22px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 4px;
    padding: 4px;
    z-index: 100;
  }
  .btn {
    background: transparent;
    border: 0;
    color: var(--fg-1);
    width: 38px;
    height: 38px;
    border-radius: 999px;
    cursor: pointer;
    display: grid;
    place-items: center;
    font-size: 16px;
  }
  .btn[aria-checked='true'] {
    background: var(--accent-soft);
    color: var(--fg-0);
  }
  .btn:hover:not([aria-checked='true']) {
    background: rgba(255, 255, 255, 0.04);
  }
</style>
