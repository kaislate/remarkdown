<script lang="ts">
  import { resolvedAnnots } from '../stores/annots';
  import { viewerScroll } from '../stores/viewport';
  import NotePencil from 'phosphor-svelte/lib/NotePencil';
  import type { Note } from '../lib/schema';

  let open = $state(false);

  // Resolved notes only — orphaned notes live in their own panel and
  // can't be jumped-to anyway.
  const notes = $derived(
    $resolvedAnnots
      .filter((r) => r.annotation.type === 'note')
      .map((r) => ({ note: r.annotation as Note, range: r.range })),
  );

  function jumpTo(range: Range) {
    const scrollEl = $viewerScroll;
    if (!scrollEl) return;
    let rangeRect: DOMRect;
    try {
      rangeRect = range.getBoundingClientRect();
    } catch {
      return;
    }
    const scrollRect = scrollEl.getBoundingClientRect();
    // Aim to land the highlighted text ~25% down the viewport rather
    // than pinned to the top edge — easier to read from when the eye
    // arrives there.
    const margin = scrollRect.height * 0.25;
    const target = scrollEl.scrollTop + rangeRect.top - scrollRect.top - margin;
    scrollEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    open = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') open = false;
  }

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('.notes-pill-wrap')) return;
    open = false;
  }

  $effect(() => {
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  });

  function excerpt(text: string, n = 60): string {
    const s = text.replace(/\s+/g, ' ').trim();
    return s.length <= n ? s : s.slice(0, n).trimEnd() + '…';
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if notes.length > 0}
  <div class="notes-pill-wrap">
    {#if open}
      <div class="popup glass" role="dialog" aria-label="Notes">
        <header>
          <h3>Notes ({notes.length})</h3>
        </header>
        <ul>
          {#each notes as n (n.note.id)}
            <li>
              <button class="note-row" onclick={() => jumpTo(n.range)}>
                <span class="dot" aria-hidden="true"></span>
                <div class="text">
                  <div class="quote">{excerpt(n.note.anchor.text)}</div>
                  {#if n.note.body}
                    <div class="body">{excerpt(n.note.body, 80)}</div>
                  {:else}
                    <div class="body empty">(empty note)</div>
                  {/if}
                </div>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <button
      class="pill glass glass-pill"
      aria-label={open ? 'Close notes panel' : `Open notes panel (${notes.length})`}
      aria-expanded={open}
      title="Notes ({notes.length})"
      onclick={() => (open = !open)}
    >
      <NotePencil size={16} weight="regular" />
      <span class="count">{notes.length}</span>
    </button>
  </div>
{/if}

<style>
  /* Sits above the ZoomControls pill (bottom:22, ~38px tall) with a
     small gap. The popup expands UPWARD from the pill. */
  .notes-pill-wrap {
    position: fixed;
    bottom: 68px;
    left: 22px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 6px 10px;
    height: 30px;
    background: var(--glass-fill);
    border: 1px solid var(--glass-border);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .pill:hover {
    color: var(--fg-0);
    background: rgba(255, 255, 255, 0.06);
  }
  .pill[aria-expanded='true'] {
    color: var(--fg-0);
    background: var(--accent-soft);
  }
  .count {
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }

  .popup {
    width: min(360px, calc(100vw - 44px));
    max-height: min(420px, 60vh);
    padding: 6px;
    display: flex;
    flex-direction: column;
    background:
      linear-gradient(var(--bg-1), var(--bg-1)),
      var(--glass-fill);
    border: 1px solid var(--glass-border);
    border-radius: 14px;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
  }
  header {
    padding: 6px 8px;
  }
  h3 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    margin: 0;
  }
  .note-row {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    background: transparent;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1.4;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .note-row:hover {
    background: var(--accent-soft);
    color: var(--fg-0);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--accent);
    box-shadow: 0 1px 3px rgba(139, 127, 255, 0.5);
    margin-top: 4px;
    flex-shrink: 0;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .quote {
    color: var(--fg-2);
    font-size: 11px;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body {
    color: var(--fg-0);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body.empty {
    color: var(--fg-2);
    font-weight: 400;
    font-style: italic;
  }
</style>
