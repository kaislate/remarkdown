<script lang="ts">
  import { tool, setColor, HIGHLIGHT_COLORS, DRAW_COLORS } from '../stores/tool';
  const palette = $derived(
    $tool.mode === 'highlight' ? HIGHLIGHT_COLORS :
    $tool.mode === 'draw' ? DRAW_COLORS :
    null
  );
  const active = $derived(
    $tool.mode === 'highlight' ? $tool.highlightColor :
    $tool.mode === 'draw' ? $tool.drawColor :
    null
  );
</script>

{#if palette}
  <div class="strip glass glass-pill" role="radiogroup" aria-label="Color">
    {#each palette as c (c)}
      <button
        class="swatch"
        role="radio"
        aria-checked={active === c}
        aria-label={`Color ${c}`}
        style="background:{c}"
        onclick={() => setColor(c)}
      ></button>
    {/each}
  </div>
{/if}

<style>
  .strip {
    position: fixed;
    bottom: 68px;
    right: 22px;
    display: flex;
    gap: 6px;
    padding: 6px;
    z-index: 100;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 1.5px solid rgba(255,255,255,0.1);
    cursor: pointer;
    padding: 0;
  }
  .swatch[aria-checked='true'] {
    border-color: var(--fg-0);
    outline: 2px solid var(--accent-soft);
  }
</style>
