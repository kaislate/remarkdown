<script lang="ts">
  import ListBullets from 'phosphor-svelte/lib/ListBullets';
  import { untrack } from 'svelte';
  import { doc } from '../stores/doc';
  import { currentViewerRoot } from '../stores/annots';
  import { viewerScroll } from '../stores/viewport';
  import { get } from 'svelte/store';
  import { jumpToSection } from '../lib/section-jump';

  // After picking an entry the popover stays a moment: long enough to see
  // the marker slide to it (0.34s) and the ink set off.
  const CLOSE_AFTER_PICK_MS = 420;

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

  function headingEl(h: Heading): HTMLElement | null {
    const root = get(currentViewerRoot);
    return root?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(h.id)}"]`) ?? null;
  }

  // The section being read (the last heading come up to the top third of
  // the page), marked on the list's track while it's open.
  let current = $state(-1);
  let itemEls = $state<HTMLElement[]>([]);
  let listEl = $state<HTMLElement | null>(null);
  let marker = $state<{ top: number; height: number } | null>(null);
  let picked = false;

  function measureCurrent() {
    if (picked) return;
    const scrollEl = get(viewerScroll);
    if (!scrollEl) return;
    const view = scrollEl.getBoundingClientRect();
    const line = view.top + view.height / 3;
    let at = -1;
    headings.forEach((h, i) => {
      const el = headingEl(h);
      if (el && el.getBoundingClientRect().top <= line) at = i;
    });
    current = at;
  }

  $effect(() => {
    if (!open) return;
    picked = false;
    measureCurrent();
    const scrollEl = $viewerScroll;
    scrollEl?.addEventListener('scroll', measureCurrent, { passive: true });
    return () => scrollEl?.removeEventListener('scroll', measureCurrent);
  });

  $effect(() => {
    const el = current >= 0 ? itemEls[current] : null;
    marker = el ? { top: el.offsetTop, height: el.offsetHeight } : null;
  });

  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  function scrollToHeading(h: Heading, i: number) {
    const el = headingEl(h);
    if (!el) return;
    picked = true;
    current = i;
    // The ink wells up on the track, level with the picked entry.
    const item = itemEls[i]?.getBoundingClientRect();
    const track = listEl?.getBoundingClientRect();
    const from = item && track ? { x: track.left + 7, y: item.top + item.height / 2 } : undefined; // the track is 6px in
    jumpToSection(el, { from });
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { open = false; closeTimer = null; }, CLOSE_AFTER_PICK_MS);
  }

  function toggle() { open = !open; }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
    }
  }

  // Close popover when clicking outside. Checked against the event's path,
  // not target.closest(): opening redraws the button's icon (regular ->
  // fill), so by the time the click bubbles here the clicked <path> has
  // left the document and would read as an outside click.
  function onDocumentClick(e: MouseEvent) {
    if (!open) return;
    const inside = e.composedPath().some((n) =>
      n instanceof Element && (n.classList.contains('toc-popover') || n.classList.contains('toc-button')));
    if (inside) return;
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
    <div class="toc-list" bind:this={listEl}>
      <span class="track" aria-hidden="true"></span>
      {#if marker}
        <span class="marker" aria-hidden="true" style:top={`${marker.top}px`} style:height={`${marker.height}px`}></span>
      {/if}
      <ul>
        {#each headings as h, i (h.id + i)}
          <li class="level-{h.level}" bind:this={itemEls[i]}>
            <button
              class="toc-entry"
              class:current={i === current}
              aria-current={i === current ? 'location' : undefined}
              onclick={() => scrollToHeading(h, i)}
              title={h.text}
            >{h.text}</button>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  /* Third in the top-left stack: hamburger (top:14), EditMode (top:60),
     this button (top:106 = 60 + 38 + 8 gap), Reader toggle (top:152). */
  .toc-button {
    position: fixed;
    top: 106px;
    left: 14px;
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

  /* Popover floats to the RIGHT of the button (now at top:106, left:14,
     right-edge at x=52). Offset 8px gap so the glass border doesn't
     kiss the pill. Top-aligned with the button. */
  .toc-popover {
    position: fixed;
    top: 106px;
    left: 60px;
    z-index: 110;
    width: min(340px, calc(100vw - 80px));
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: tocIn 0.18s ease-out;
  }
  @keyframes tocIn {
    from { opacity: 0; transform: translateX(-6px); }
    to   { opacity: 1; transform: translateX(0); }
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
  /* The list scrolls; down its left edge runs a track, and a marker on it
     shows the section being read — sliding to an entry when it's picked
     (the ink sets off from there). */
  .toc-list {
    position: relative;
    overflow-y: auto;
    flex: 1;
  }
  .toc-popover ul {
    list-style: none;
    margin: 0;
    padding: 6px 0;
  }
  .track {
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 6px;
    width: 2px;
    border-radius: 1px;
    background: var(--glass-border);
  }
  .marker {
    position: absolute;
    left: 6px;
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
    transition:
      top 0.34s cubic-bezier(0.34, 1.4, 0.64, 1),
      height 0.34s cubic-bezier(0.34, 1.4, 0.64, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .marker { transition: none; }
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
  .toc-entry.current { color: var(--accent); }
</style>
