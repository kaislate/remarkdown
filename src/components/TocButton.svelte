<script lang="ts">
  import ListBullets from 'phosphor-svelte/lib/ListBullets';
  import { untrack } from 'svelte';
  import { doc } from '../stores/doc';
  import { currentViewerRoot } from '../stores/annots';
  import { viewerScroll } from '../stores/viewport';
  import { get } from 'svelte/store';

  interface Heading {
    text: string;
    level: number; // 1..4
    id: string;    // unique-ish ref to find the element later
  }

  let open = $state(false);

  // Extract headings from the article DOM. Recomputed when the doc
  // changes (via $doc dependency) or when the popover is opened
  // (so a recent edit's headings show up after a file watcher reload).
  let headingsTick = $state(0);
  $effect(() => {
    void $doc; // re-run on doc change
    untrack(() => { headingsTick += 1; });
  });

  const headings = $derived.by((): Heading[] => {
    void headingsTick;
    void open; // also re-run when opening
    const root = $currentViewerRoot;
    if (!root) return [];
    const els = root.querySelectorAll<HTMLElement>('h1, h2, h3, h4');
    return Array.from(els).map((el, i) => ({
      text: el.textContent?.trim() ?? '',
      level: parseInt(el.tagName.substring(1), 10),
      id: el.getAttribute('data-block-id') ?? `_h_${i}`,
    }));
  });

  function scrollToHeading(h: Heading) {
    const root = get(currentViewerRoot);
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(h.id)}"]`);
    if (!el) return;
    // Use the scroll element's scrollTo for smoother integration with
    // the viewer's flexbox layout. Falls back to scrollIntoView.
    const scrollEl = get(viewerScroll);
    if (scrollEl) {
      const elRect = el.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const target = scrollEl.scrollTop + (elRect.top - scrollRect.top) - 24;
      scrollEl.scrollTo({ top: target, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    open = false;
  }

  function toggle() { open = !open; }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
    }
  }

  // Close popover when clicking outside.
  function onDocumentClick(e: MouseEvent) {
    if (!open) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('.toc-popover') || t?.closest('.toc-button')) return;
    open = false;
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  });
</script>

<svelte:window onkeydown={onKeydown} />

<button
  class="toc-button glass glass-pill"
  class:active={open}
  aria-label={open ? 'Close table of contents' : 'Open table of contents'}
  aria-expanded={open}
  title="Table of contents"
  onclick={toggle}
  disabled={headings.length === 0}
>
  <ListBullets size={20} weight={open ? 'fill' : 'regular'} />
</button>

{#if open && headings.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="toc-popover glass" role="dialog" aria-label="Table of contents">
    <header>
      <span class="toc-title">Table of contents</span>
      <span class="toc-count">{headings.length}</span>
    </header>
    <ul>
      {#each headings as h, i (h.id + i)}
        <li class="level-{h.level}">
          <button
            class="toc-entry"
            onclick={() => scrollToHeading(h)}
            title={h.text}
          >{h.text}</button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  /* Stacked above the reader-mode (Focus) toggle at left:144, bottom:22.
     Same x so the two pills line up vertically; offset bottom by the
     toggle height (38) plus a small gap (8) = 68px above the bottom. */
  .toc-button {
    position: fixed;
    bottom: 68px;
    left: 144px;
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    color: var(--fg-1);
    cursor: pointer;
    padding: 0;
    z-index: 100;
    transition:
      opacity 0.2s ease,
      color 0.2s ease,
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      border-color 0.2s ease,
      background 0.2s ease;
  }
  .toc-button:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent-soft);
    background: rgba(139, 127, 255, 0.08);
    transform: scale(1.05);
  }
  .toc-button.active {
    color: var(--accent);
    border-color: var(--accent-soft);
    background: rgba(139, 127, 255, 0.12);
  }
  .toc-button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Popover floats above the button (which sits at bottom:68 + height:38
     = top edge at bottom:106). Offset 10px above the button so the
     glass border doesn't kiss the pill. Anchored at left:22 so the
     popover spans the same edge as the zoom + re.marks pills below. */
  .toc-popover {
    position: fixed;
    bottom: 116px;
    left: 22px;
    z-index: 110;
    width: min(340px, calc(100vw - 44px));
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: tocIn 0.18s ease-out;
  }
  @keyframes tocIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .toc-popover header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--glass-border);
  }
  .toc-title {
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .toc-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }
  .toc-popover ul {
    list-style: none;
    margin: 0;
    padding: 6px 0;
    overflow-y: auto;
    flex: 1;
  }
  .toc-popover li {
    margin: 0;
  }
  .toc-popover .level-1 { padding-left: 10px; }
  .toc-popover .level-2 { padding-left: 22px; }
  .toc-popover .level-3 { padding-left: 34px; }
  .toc-popover .level-4 { padding-left: 46px; }
  .toc-entry {
    display: block;
    width: calc(100% - 10px);
    text-align: left;
    background: transparent;
    border: 0;
    color: var(--fg-0);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 5px 10px;
    margin-right: 4px;
    border-radius: 6px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.35;
  }
  .toc-popover .level-1 .toc-entry {
    color: var(--fg-0);
    font-weight: 600;
  }
  .toc-popover .level-2 .toc-entry { color: var(--fg-0); }
  .toc-popover .level-3 .toc-entry { color: var(--fg-1); font-size: 12px; }
  .toc-popover .level-4 .toc-entry { color: var(--fg-2); font-size: 12px; }
  .toc-entry:hover { background: var(--accent-soft); color: var(--accent); }
</style>
