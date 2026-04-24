<script lang="ts">
  import { onMount } from 'svelte';
  import { doc } from '../stores/doc';
  import { viewerScroll } from '../stores/viewport';
  import { computeMinimapLayout, minimapClickToScrollTop } from '../lib/minimap-math';

  // Matches .viewer max-width in Viewer.svelte. The minimap scales against this.
  const VIEWER_CONTENT_WIDTH = 720;

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

    const layout = computeMinimapLayout(
      scroll.scrollTop,
      scroll.scrollHeight,
      scroll.clientHeight,
      VIEWER_CONTENT_WIDTH,
      map.clientWidth,
      map.clientHeight,
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
    const clickY = e.clientY - rect.top;
    scroll.scrollTop = minimapClickToScrollTop(
      clickY,
      translateY,
      scale,
      scroll.clientHeight,
      scroll.scrollHeight,
    );
  }

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // jsdom / unsupported — best-effort
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
      // best-effort
    }
  }

  onMount(() => {
    let currentScrollEl: HTMLElement | null = null;

    const unsubScroll = viewerScroll.subscribe((el) => {
      if (currentScrollEl) currentScrollEl.removeEventListener('scroll', updateLayout);
      currentScrollEl = el;
      if (el) {
        el.addEventListener('scroll', updateLayout, { passive: true });
        // Measure now (correct when state is already set, e.g. tests) and again on the next
        // frame (correct in production when the doc HTML hasn't reflowed yet).
        updateLayout();
        requestAnimationFrame(updateLayout);
      }
    });

    const unsubDoc = doc.subscribe(() => {
      // Let the rendered HTML settle, then recompute.
      requestAnimationFrame(() => requestAnimationFrame(updateLayout));
    });

    window.addEventListener('resize', updateLayout);

    return () => {
      if (currentScrollEl) currentScrollEl.removeEventListener('scroll', updateLayout);
      window.removeEventListener('resize', updateLayout);
      unsubDoc();
      unsubScroll();
    };
  });
</script>

{#if $doc !== null}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="minimap"
    bind:this={minimapEl}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    role="presentation"
    aria-hidden="true"
  >
    <div
      class="minimap-content"
      style="transform: translateY({translateY}px) scale({scale}); transform-origin: top left; width: {VIEWER_CONTENT_WIDTH}px;"
    >
      {@html $doc.html}
    </div>
    <div
      class="viewport-indicator"
      class:dragging
      style="top: {indicatorTop}px; height: {indicatorHeight}px;"
    ></div>
  </div>
{/if}

<style>
  .minimap {
    position: fixed;
    top: 0;
    right: 0;
    width: 100px;
    height: 100vh;
    background: rgba(0, 0, 0, 0.25);
    border-left: 1px solid var(--glass-border);
    overflow: hidden;
    z-index: 60;
    cursor: pointer;
    user-select: none;
  }
  .minimap:hover { background: rgba(0, 0, 0, 0.32); }
  .minimap-content {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    color: var(--fg-1);
    will-change: transform;
  }
  /* Strip visual noise from the scaled clone so structure reads at a glance. */
  .minimap-content :global(a) { border-bottom: none; }
  .minimap-content :global(pre),
  .minimap-content :global(blockquote),
  .minimap-content :global(code) {
    background: transparent;
    border: none;
    padding: 0;
  }
  .minimap-content :global(img) { opacity: 0.5; }
  .viewport-indicator {
    position: absolute;
    left: 0;
    right: 0;
    background: rgba(139, 127, 255, 0.15);
    border-top: 1px solid rgba(139, 127, 255, 0.3);
    border-bottom: 1px solid rgba(139, 127, 255, 0.3);
    pointer-events: none;
    transition: background 0.15s;
  }
  .viewport-indicator.dragging {
    background: rgba(139, 127, 255, 0.28);
  }
  @media (max-width: 900px) {
    .minimap { display: none; }
  }
</style>
