<script lang="ts">
  import { get } from 'svelte/store';
  import { openFileDialog } from '../lib/tauri-api';
  import { loadDocument } from '../stores/doc';
  import { recent, recordRecent, recentExistence, markMissing } from '../stores/recent';
  import { orphanedAnnots } from '../stores/annots';
  import { openModal } from '../stores/modals';
  import { addToast } from '../stores/toasts';

  let open = $state(false);

  function toggle() { open = !open; }

  async function handleOpen() {
    open = false;
    const path = await openFileDialog();
    if (!path) return;
    await loadDocument(path);
    await recordRecent(path);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }

  function basename(p: string): string {
    return p.split(/[\\/]/).pop() ?? p;
  }

  async function openRecent(path: string) {
    open = false;
    if (get(recentExistence)[path] === false) {
      addToast({ kind: 'warning', message: `File not found: ${basename(path)}` });
      return;
    }
    try {
      await loadDocument(path);
      await recordRecent(path);
    } catch (e) {
      markMissing(path);
      addToast({ kind: 'error', message: `Could not open ${basename(path)}: ${(e as Error).message}` });
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="menu-root">
  <button class="hamburger glass" aria-label="Menu" aria-expanded={open} onclick={toggle}>
    <span class="bar"></span>
    <span class="bar"></span>
    <span class="bar"></span>
  </button>

  <!-- Brand mark next to the hamburger. pointer-events:none so window
       dragging still works through the wordmark area. -->
  <span class="wordmark" aria-hidden="true">re<span class="dot">.</span>md</span>

  {#if open}
    <div class="popover glass" role="menu">
      <button role="menuitem" class="item" onclick={handleOpen}>Open…</button>
      <!-- Open Recent lands in Plan 3. -->
      <button
        role="menuitem"
        class="item"
        disabled={$orphanedAnnots.length === 0}
        onclick={() => { open = false; openModal({ kind: 'orphans' }); }}
      >
        Orphaned Annotations{$orphanedAnnots.length > 0 ? ` (${$orphanedAnnots.length})` : ''}
      </button>
      {#if $recent.length > 0}
        <div class="separator" role="separator"></div>
        <div class="submenu-label">Open Recent</div>
        {#each $recent as path (path)}
          <button
            class="item recent"
            class:missing={$recentExistence[path] === false}
            role="menuitem"
            onclick={() => openRecent(path)}
            title={path}
          >
            {basename(path)}{$recentExistence[path] === false ? ' (missing)' : ''}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .menu-root {
    position: fixed;
    top: 14px;
    left: 14px;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .hamburger {
    width: 38px;
    height: 38px;
    display: grid;
    grid-auto-flow: row;
    gap: 5px;
    align-content: center;
    justify-items: center;
    background: var(--glass-fill);
    border: 1px solid var(--glass-border);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .wordmark {
    font-family: var(--font-sans);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--fg-0);
    line-height: 1;
    user-select: none;
    pointer-events: none;
  }
  .wordmark .dot { color: var(--accent); }
  .bar {
    width: 16px;
    height: 1.5px;
    background: var(--fg-1);
    border-radius: 1px;
  }
  .popover {
    position: absolute;
    top: 46px;
    left: 0;
    min-width: 200px;
    padding: 6px;
    display: flex;
    flex-direction: column;
  }
  .item {
    background: transparent;
    border: 0;
    padding: 10px 12px;
    border-radius: 8px;
    color: var(--fg-0);
    text-align: left;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 14px;
  }
  .item:hover {
    background: var(--accent-soft);
  }
  .item[disabled] {
    color: var(--fg-2);
    cursor: default;
    opacity: 0.5;
  }
  .item[disabled]:hover { background: transparent; }
  .separator {
    height: 1px;
    background: var(--glass-border);
    margin: 4px 0;
  }
  .submenu-label {
    font-family: var(--font-sans);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-2);
    padding: 4px 10px;
  }
  .item.recent {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }
  .item.missing { color: var(--fg-2); font-style: italic; }
</style>
