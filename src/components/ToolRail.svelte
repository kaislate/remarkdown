<script lang="ts">
  import { tool, setMode } from '../stores/tool';
  import type { Tool } from '../lib/schema';
  import Cursor from 'phosphor-svelte/lib/Cursor';
  import Highlighter from 'phosphor-svelte/lib/Highlighter';
  import NotePencil from 'phosphor-svelte/lib/NotePencil';
  import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
  import Eraser from 'phosphor-svelte/lib/Eraser';
  import type { Component } from 'svelte';

  const TOOLS: { mode: Tool; label: string; icon: Component }[] = [
    { mode: 'cursor', label: 'Cursor', icon: Cursor },
    { mode: 'highlight', label: 'Highlight', icon: Highlighter },
    { mode: 'note', label: 'Note', icon: NotePencil },
    { mode: 'draw', label: 'Draw', icon: PencilSimple },
    { mode: 'eraser', label: 'Eraser', icon: Eraser },
  ];
</script>

<div class="rail glass glass-pill" role="radiogroup" aria-label="Annotation tool">
  {#each TOOLS as t (t.mode)}
    <button
      class="btn"
      role="radio"
      aria-checked={$tool.mode === t.mode}
      aria-label={t.label}
      title={t.label}
      onclick={() => setMode(t.mode)}
    >
      <span class="glyph" aria-hidden="true">
        <svelte:component this={t.icon} size={18} weight="regular" />
      </span>
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
    transition: background 0.15s ease, color 0.15s ease;
  }
  .btn[aria-checked='true'] {
    background: var(--accent-soft);
    color: var(--fg-0);
  }
  .btn:hover:not([aria-checked='true']) {
    background: rgba(255, 255, 255, 0.04);
    color: var(--fg-0);
  }
  .glyph {
    display: grid;
    place-items: center;
    line-height: 0;
  }
</style>
