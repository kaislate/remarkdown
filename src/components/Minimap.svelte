<script lang="ts">
  import { onMount } from 'svelte';
  import { readerMode } from '../stores/reader-mode';
  import { doc } from '../stores/doc';
  import { currentViewerRoot } from '../stores/annots';
  import { viewerScroll, currentEditorRoot } from '../stores/viewport';
  import { minimapShown, toggleMinimap } from '../stores/ui';
  import { computeMinimapLayout, minimapClickToScrollTop } from '../lib/minimap-math';
  import { prefixIds } from '../lib/prefix-ids';

  // Must match Viewer.svelte's .viewer padding. The clone is rendered at the
  // article's measured width (its width follows the article-width setting
  // and the room the window leaves), so the clone wraps every line exactly
  // where the article does and the indicator math is exact.
  const VIEWER_CONTENT_WIDTH = 720;
  const VIEWER_PADDING_H = 48;
  const VIEWER_PADDING_T = 96;
  const VIEWER_PADDING_B = 160;
  const VIEWER_OUTER_WIDTH = VIEWER_CONTENT_WIDTH + 2 * VIEWER_PADDING_H;
  const MINIMAP_WIDTH = 140;

  // What's being mirrored: the reading article, or — while editing — the
  // editor's content element, which lays out a little differently (diagrams
  // carry their editing controls) and is what's actually on screen.
  let articleEl: HTMLElement | null = null;
  let editorEl: HTMLElement | null = null;
  let sourceEl: HTMLElement | null = null;
  let cloneWidth = $state(VIEWER_OUTER_WIDTH);

  let minimapEl = $state<HTMLElement | null>(null);
  let cloneEl = $state<HTMLElement | null>(null);

  let scale = $state(1);
  // The article's own padding and type size, copied onto the clone: reader
  // mode changes both (a taller top margin, larger text), and the clone
  // has to lay out exactly like the page for the box to be exact.
  let pad = $state({ t: VIEWER_PADDING_T, h: VIEWER_PADDING_H, b: VIEWER_PADDING_B });
  let fontSize = $state('');
  let translateY = $state(0);
  let indicatorTop = $state(0);
  let indicatorHeight = $state(20);

  let dragging = $state(false);
  let lastArticleTop = 0;

  // We mirror the live article DOM (post mermaid + any other JS-driven
  // transforms) rather than re-rendering $doc.html. That way the minimap
  // visually matches what the user is actually scrolling through and the
  // indicator lines up with the right region.
  let mirroredHtml = $state('');

  function updateLayout(): void {
    const scroll = $viewerScroll;
    const map = minimapEl;
    if (!scroll || !map) return;

    // Use clientWidth minus horizontal padding so we scale against the visible
    // content area of the minimap, not the outer glass padding.
    const innerWidth = map.clientWidth - 16; // 8px padding each side
    const innerHeight = map.clientHeight - 16;

    // Where the article sits in the scroll content. The scroll container is
    // exactly the visible page (it starts below the title band / right of
    // the tab sidebar), so the box is [scrollTop, scrollTop + clientHeight]
    // in these coordinates. If the source has no layout (yet), treat the
    // whole scroll content as the page.
    let articleTop = 0;
    let articleHeight = scroll.scrollHeight;
    let width = VIEWER_OUTER_WIDTH;
    if (sourceEl && sourceEl.offsetWidth > 0) {
      const top = sourceEl.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      if (sourceEl === editorEl) {
        // The editor's element is the text itself, without the article's
        // padding (and the first block's top margin collapses out of it),
        // so line the clone up by its first block instead.
        width = sourceEl.offsetWidth + 2 * VIEWER_PADDING_H;
        articleTop = top - VIEWER_PADDING_T;
        articleHeight = sourceEl.offsetHeight + VIEWER_PADDING_T + VIEWER_PADDING_B;
        const first = sourceEl.firstElementChild;
        const cloneFirst = cloneEl?.firstElementChild;
        if (first && cloneFirst && cloneEl!.offsetHeight > 0) {
          const firstTop = first.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
          const cloneScale = cloneEl!.getBoundingClientRect().width / cloneEl!.offsetWidth;
          const inClone = (cloneFirst.getBoundingClientRect().top - cloneEl!.getBoundingClientRect().top) / cloneScale;
          articleTop = firstTop - inClone;
          articleHeight = cloneEl!.offsetHeight;
        }
      } else {
        articleTop = top;
        articleHeight = sourceEl.offsetHeight;
        width = sourceEl.offsetWidth;
        const cs = getComputedStyle(sourceEl);
        const t = parseFloat(cs.paddingTop);
        const h = parseFloat(cs.paddingLeft);
        const b = parseFloat(cs.paddingBottom);
        if (t !== pad.t || h !== pad.h || b !== pad.b) pad = { t, h, b };
        fontSize = cs.fontSize;
      }
    }
    cloneWidth = width;
    lastArticleTop = articleTop;

    const layout = computeMinimapLayout(
      scroll.scrollTop,
      scroll.scrollHeight,
      scroll.clientHeight,
      width,
      innerWidth,
      innerHeight,
      articleTop,
      articleHeight,
    );
    scale = layout.scale;
    translateY = layout.translateY;
    indicatorTop = layout.indicatorTop;
    indicatorHeight = layout.indicatorHeight;
  }

  function scrollToClick(e: PointerEvent | MouseEvent): void {
    const scroll = $viewerScroll;
    const map = minimapEl;
    if (!scroll || !map) return;
    const rect = map.getBoundingClientRect();
    // Compensate for the inner padding so clicks feel accurate.
    const clickY = (e.clientY - rect.top) - 8;
    scroll.scrollTop = minimapClickToScrollTop(
      clickY,
      translateY,
      scale,
      scroll.clientHeight,
      scroll.scrollHeight,
      lastArticleTop,
    );
  }

  function onPointerDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('.minimap-toggle')) return;
    dragging = true;
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom / unsupported */
    }
    scrollToClick(e);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    scrollToClick(e);
  }

  function onPointerUp(e: PointerEvent): void {
    dragging = false;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* best-effort */
    }
  }

  onMount(() => {
    let currentScrollEl: HTMLElement | null = null;
    let mutationObserver: MutationObserver | null = null;
    let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

    function snapshotArticle(): void {
      if (!sourceEl) return;
      // Mirror a clone whose ids are prefixed (references rewritten to
      // match) — the clone shares the document with the article, and
      // each diagram svg alone carries dozens of ids its own markers,
      // gradients and inline styles point at. See prefix-ids.ts.
      const clone = sourceEl.cloneNode(true) as HTMLElement;
      prefixIds(clone, 'minimap-');
      mirroredHtml = clone.innerHTML;
      // Recompute the indicator after the new HTML lays out in the clone.
      requestAnimationFrame(() => requestAnimationFrame(updateLayout));
    }

    function scheduleSnapshot(): void {
      if (snapshotTimer) clearTimeout(snapshotTimer);
      // ~120ms debounce coalesces the burst of mutations from a sequence
      // of mermaid renders (each diagram fires several mutations).
      snapshotTimer = setTimeout(snapshotArticle, 120);
    }

    // Layout changes that move or resize the page without a scroll event:
    // the title band / tab sidebar appearing, zoom, window size, images or
    // diagrams settling.
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => updateLayout());

    const unsubScroll = viewerScroll.subscribe((el) => {
      if (currentScrollEl) {
        currentScrollEl.removeEventListener('scroll', updateLayout);
        resizeObserver?.unobserve(currentScrollEl);
      }
      currentScrollEl = el;
      if (el) {
        resizeObserver?.observe(el);
        el.addEventListener('scroll', updateLayout, { passive: true });
        updateLayout();
        requestAnimationFrame(updateLayout);
      }
    });

    // Mirror the editor while there is one, else the article. Initial
    // snapshot, then keep it in sync with later mutations (diagrams drawn,
    // typing).
    function setSource(): void {
      const next = editorEl ?? articleEl;
      if (next === sourceEl) return;
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
      if (sourceEl) resizeObserver?.unobserve(sourceEl);
      sourceEl = next;
      if (!next) {
        mirroredHtml = '';
        return;
      }
      resizeObserver?.observe(next);
      snapshotArticle();
      mutationObserver = new MutationObserver(scheduleSnapshot);
      mutationObserver.observe(next, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    }

    const unsubArticle = currentViewerRoot.subscribe((el) => {
      articleEl = el;
      setSource();
    });
    const unsubEditor = currentEditorRoot.subscribe((el) => {
      editorEl = el;
      setSource();
    });

    const unsubDoc = doc.subscribe(() => {
      requestAnimationFrame(() => requestAnimationFrame(updateLayout));
    });

    // Also recompute after the slide-in transition finishes so dimensions are right.
    const unsubShown = minimapShown.subscribe(() => {
      setTimeout(updateLayout, 300);
    });

    // Entering or leaving reader mode changes the page's layout (column,
    // type size) and the minimap's own size, or shows / hides it; recompute
    // across two frames so it lands after the browser has re-laid out.
    const unsubReader = readerMode.subscribe(() => {
      requestAnimationFrame(() => requestAnimationFrame(updateLayout));
    });

    window.addEventListener('resize', updateLayout);

    return () => {
      if (currentScrollEl) currentScrollEl.removeEventListener('scroll', updateLayout);
      window.removeEventListener('resize', updateLayout);
      if (mutationObserver) mutationObserver.disconnect();
      resizeObserver?.disconnect();
      if (snapshotTimer) clearTimeout(snapshotTimer);
      unsubDoc();
      unsubShown();
      unsubScroll();
      unsubReader();
      unsubArticle();
      unsubEditor();
    };
  });
</script>

{#if $doc !== null}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="minimap glass"
    class:hidden={!$minimapShown}
    bind:this={minimapEl}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    role="presentation"
    aria-hidden="true"
    style="--mm-width: {MINIMAP_WIDTH}px;"
  >
    <div class="minimap-inner">
      <div
        class="minimap-content md-rendered"
        bind:this={cloneEl}
        style="transform: translateY({translateY}px) scale({scale}); transform-origin: top left; width: {cloneWidth}px; padding: {pad.t}px {pad.h}px {pad.b}px; box-sizing: border-box; font-size: {fontSize};"
      >
        {@html mirroredHtml}
      </div>
      <div
        class="viewport-indicator"
        class:dragging
        style="top: {indicatorTop}px; height: {indicatorHeight}px;"
      ></div>
    </div>
  </div>

  <button
    class="minimap-toggle glass"
    class:collapsed={!$minimapShown}
    aria-label={$minimapShown ? 'Hide minimap' : 'Show minimap'}
    title={$minimapShown ? 'Hide minimap' : 'Show minimap'}
    onclick={toggleMinimap}
  >
    <span aria-hidden="true">{$minimapShown ? '›' : '‹'}</span>
  </button>
{/if}

<style>
  /* Floating: inset from all edges, fully rounded, soft shadow. */
  .minimap {
    position: fixed;
    top: 52px;
    right: 16px;
    /* Tightened to clear the bottom-right ToolRail (bottom:22 + 38 height
       = top at 60) and ColorStrip (above the rail at bottom:68 + 34
       height = top at 102), with a small breathing gap above the
       controls stack. */
    bottom: 110px;
    width: var(--mm-width);
    overflow: hidden;
    /* z-index sits above the welcome tutorial backdrop (z:80) so the
       minimap stays sharp during the tutorial — but below the chrome
       (hamburger, tool rail, etc. at z:100) and the tutorial tips
       inside .overlay (z:90) so it doesn't cover important controls. */
    z-index: 85;
    cursor: pointer;
    user-select: none;
    background: rgba(17, 15, 25, 0.55);
    border: 1px solid var(--glass-border);
    border-radius: 14px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 12px 36px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
    transform: translateX(0);
    transition: transform 0.32s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .minimap.hidden {
    /* Slide fully off the right edge, including the 16px gutter. */
    transform: translateX(calc(100% + 24px));
  }
  .minimap:hover {
    background: rgba(17, 15, 25, 0.7);
  }
  .minimap-inner {
    position: absolute;
    inset: 8px;
  }
  .minimap-content {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    will-change: transform;
  }
  /* Reduce visual noise in the scaled clone but PRESERVE box sizes (padding,
     borders) so the clone's rendered height exactly matches the main viewer's.
     The viewport indicator's accuracy depends on this match. */
  .minimap-content :global(a) { border-bottom-color: transparent; }
  .minimap-content :global(pre),
  .minimap-content :global(code) {
    background-color: transparent;
    border-color: transparent;
  }
  .minimap-content :global(img) { opacity: 0.45; }
  .viewport-indicator {
    position: absolute;
    left: 0;
    right: 0;
    /* Borders inside the box, so its outer edges are exactly the visible
       range (content-box made it 2px too tall). */
    box-sizing: border-box;
    background: rgba(139, 127, 255, 0.18);
    border-top: 1px solid rgba(139, 127, 255, 0.36);
    border-bottom: 1px solid rgba(139, 127, 255, 0.36);
    pointer-events: none;
    transition: background 0.15s;
    border-radius: 2px;
  }
  .viewport-indicator.dragging {
    background: rgba(139, 127, 255, 0.32);
  }

  /* Toggle arrow — sits just outside the minimap's left edge when shown,
     hugs the window's right edge when the minimap is collapsed. */
  .minimap-toggle {
    position: fixed;
    top: 50vh;
    transform: translateY(-50%);
    right: calc(var(--mm-width) + 16px + 6px); /* minimap width + gutter + small overlap */
    width: 20px;
    height: 48px;
    padding: 0;
    z-index: 70;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    background: rgba(17, 15, 25, 0.7);
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
    color: var(--fg-1);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 16px;
    line-height: 1;
    display: grid;
    place-items: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    transition: right 0.32s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s, background 0.15s;
    --mm-width: 140px;
  }
  .minimap-toggle.collapsed {
    right: 8px;
  }
  .minimap-toggle:hover {
    color: var(--fg-0);
    background: rgba(17, 15, 25, 0.9);
  }

  @media (max-width: 900px) {
    .minimap, .minimap-toggle { display: none; }
  }
</style>
