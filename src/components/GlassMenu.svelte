<script lang="ts">
  import { get } from 'svelte/store';
  import { openFileDialog } from '../lib/tauri-api';
  import { loadDocument } from '../stores/doc';
  import { recent, recordRecent, recentExistence, markMissing, removeFromRecent, clearAllRecent } from '../stores/recent';
  import { orphanedAnnots, annots } from '../stores/annots';
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

  async function removeRecentItem(path: string, e: MouseEvent) {
    // Stop the click from bubbling to the row's openRecent handler.
    e.stopPropagation();
    e.preventDefault();
    try {
      await removeFromRecent(path);
    } catch (err) {
      addToast({ kind: 'error', message: `Could not remove from recents: ${(err as Error).message}` });
    }
  }

  async function clearAll() {
    try {
      await clearAllRecent();
      addToast({ kind: 'info', message: 'Recent files list cleared.' });
    } catch (err) {
      addToast({ kind: 'error', message: `Could not clear recents: ${(err as Error).message}` });
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
      <button
        role="menuitem"
        class="item"
        disabled={$orphanedAnnots.length === 0}
        onclick={() => { open = false; openModal({ kind: 'orphans' }); }}
      >
        Orphaned Annotations{$orphanedAnnots.length > 0 ? ` (${$orphanedAnnots.length})` : ''}
      </button>
      <button
        role="menuitem"
        class="item"
        onclick={() => { open = false; openModal({ kind: 'settings' }); }}
      >
        Settings…
      </button>
      <button
        role="menuitem"
        class="item danger"
        disabled={$annots.length === 0}
        onclick={() => { open = false; openModal({ kind: 'confirm-clear-annots' }); }}
      >
        Clear all annotations…{$annots.length > 0 ? ` (${$annots.length})` : ''}
      </button>
      {#if $recent.length > 0}
        <div class="separator" role="separator"></div>
        <div class="submenu-label">Open Recent</div>
        {#each $recent as path (path)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="recent-row"
            class:missing={$recentExistence[path] === false}
            role="menuitem"
            tabindex="-1"
            title={path}
            onclick={(e) => {
              // Defensive guard: even though removeRecentItem stops
              // propagation, check the click target so the row never
              // mistakenly opens the file when the user meant to remove.
              if ((e.target as HTMLElement).closest?.('.recent-remove')) return;
              openRecent(path);
            }}
          >
            <span class="recent-name">
              {basename(path)}{$recentExistence[path] === false ? ' (missing)' : ''}
            </span>
            <button
              class="recent-remove"
              aria-label={`Remove ${basename(path)} from recents`}
              title="Remove from recents"
              onclick={(e) => removeRecentItem(path, e)}
            >×</button>
          </div>
        {/each}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="clear-recents"
          role="menuitem"
          tabindex="0"
          onclick={clearAll}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clearAll(); } }}
        >Clear recents</div>
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
  /* Destructive items (Clear all annotations) hint at their consequence
     by warming the text on hover — same pattern as the Delete button in
     the orphan panel. */
  .item.danger:not([disabled]):hover {
    background: rgba(192, 57, 43, 0.18);
    color: #ffb0a8;
  }
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
  /* A recent entry is a flex row so the filename can ellipsis-truncate
     while the remove (×) button stays anchored to the right and only
     reveals on row hover. The row itself is a div (not a button) so we
     can nest the secondary remove button inside it without tripping the
     "no nested buttons" HTML rule. */
  .recent-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 8px 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    color: var(--fg-0);
    font-family: var(--font-sans);
    font-size: 14px;
    max-width: 260px;
  }
  .recent-row:hover {
    background: var(--accent-soft);
  }
  .recent-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-row.missing .recent-name {
    color: var(--fg-2);
    font-style: italic;
  }
  .recent-remove {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border: 0;
    background: transparent;
    color: var(--fg-2);
    font-size: 14px;
    line-height: 1;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
    padding: 0;
  }
  .recent-row:hover .recent-remove,
  .recent-remove:focus-visible {
    opacity: 1;
  }
  .recent-remove:hover {
    background: rgba(192, 57, 43, 0.2);
    color: #ffb0a8;
  }

  /* Footer link styled like the WelcomeDismiss affordance — accent
     colour, small text, no chrome. Sits at the bottom of the recents
     list as a quiet "wipe everything" action (no confirmation needed
     since recents are just metadata). */
  .clear-recents {
    margin: 4px 10px 2px;
    padding: 4px 0;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    cursor: pointer;
    user-select: none;
    transition: filter 0.12s ease;
  }
  .clear-recents:hover { filter: brightness(1.15); }
  .clear-recents:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 4px;
    border-radius: 4px;
  }
</style>
