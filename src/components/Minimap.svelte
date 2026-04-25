<script lang="ts">
  import { onMount } from 'svelte';
  import { doc } from '../stores/doc';
  import { viewerScroll } from '../stores/viewport';
  import { minimapShown, toggleMinimap } from '../stores/ui';
  import { computeMinimapLayout, minimapClickToScrollTop } from '../lib/minimap-math';

  // Must match Viewer.svelte's .text-frame max-width + .viewer padding.
  // The clone is rendered at VIEWER_OUTER_WIDTH (content + horizontal padding)
  // so its total box matches the article's, making the indicator math exact.
  const VIEWER_CONTENT_WIDTH = 720;
  const VIEWER_PADDING_H = 48;
  const VIEWER_PADDING_T = 96;
  const VIEWER_PADDING_B = 160;
  const VIEWER_OUTER_WIDTH = VIEWER_CONTENT_WIDTH + 2 * VIEWER_PADDING_H;
  const MINIMAP_WIDTH = 140;

  let minimapEl = $state<HTMLElement | null>(null);

  let scale = $state(1);
  let translateY = $state(0);
  let indicatorTop = $state(0);
  let indicatorHeight = $state(20);

  let dragging = $state(false);

  function updateLayout(): void {
    const scroll = $viewerScroll;
    const map = minimapEl;
    if (!scroll || !map) return;

    // Use clientWidth minus horizontal padding so we scale against the visible
    // content area of the minimap, not the outer glass padding.
    const innerWidth = map.clientWidth - 16; // 8px padding each side
    const innerHeight = map.clientHeight - 16;

    const layout = computeMinimapLayout(
      scroll.scrollTop,
      scroll.scrollHeight,
      scroll.clientHeight,
      VIEWER_OUTER_WIDTH,
      innerWidth,
      innerHeight,
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

    const unsubScroll = viewerScroll.subscribe((el) => {
      if (currentScrollEl) currentScrollEl.removeEventListener('scroll', updateLayout);
      currentScrollEl = el;
      if (el) {
        el.addEventListener('scroll', updateLayout, { passive: true });
        updateLayout();
        requestAnimationFrame(updateLayout);
      }
    });

    const unsubDoc = doc.subscribe(() => {
      requestAnimationFrame(() => requestAnimationFrame(updateLayout));
    });

    // Also recompute after the slide-in transition finishes so dimensions are right.
    const unsubShown = minimapShown.subscribe(() => {
      setTimeout(updateLayout, 300);
    });

    window.addEventListener('resize', updateLayout);

    return () => {
      if (currentScrollEl) currentScrollEl.removeEventListener('scroll', updateLayout);
      window.removeEventListener('resize', updateLayout);
      unsubDoc();
      unsubShown();
      unsubScroll();
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
        style="transform: translateY({translateY}px) scale({scale}); transform-origin: top left; width: {VIEWER_CONTENT_WIDTH}px; padding: {VIEWER_PADDING_T}px {VIEWER_PADDING_H}px {VIEWER_PADDING_B}px; box-sizing: content-box;"
      >
        {@html $doc.html}
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
    z-index: 60;
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
