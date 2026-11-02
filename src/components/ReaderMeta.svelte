<script lang="ts">
  // Reader mode's small meta line at the top of the column:
  // "Chapter 3 · 6 min left". The time is the words still below the
  // viewport at ~230 wpm; the section is the last heading that has
  // reached the reading line (lib/reading-time.ts). Both follow the scroll position. Hidden once there is
  // nothing left to read.
  import { viewerScroll } from '../stores/viewport';
  import { currentViewerRoot } from '../stores/annots';
  import { doc } from '../stores/doc';
  import { minutesLeft, sectionAt } from '../lib/reading-time';
  import { readerGeometry, invalidateReaderGeometry, refreshReaderGeometry, wordsBelowFold, type ReaderGeometry } from '../lib/reader-geometry';

  let minutes = $state(0);
  let section = $state<string | null>(null);

  // The h1/h2 blocks and their names, found once per measured layout.
  let headingsFor: ReaderGeometry | null = null;
  let headingIdx: { i: number; text: string }[] = [];

  // Blocks are measured once per layout (lib/reader-geometry.ts); a
  // scroll frame only reads where the article is now.
  function measure(scroll: HTMLElement, article: HTMLElement): void {
    const view = scroll.getBoundingClientRect();
    const g = readerGeometry(article);
    const origin = article.getBoundingClientRect().top;
    if (headingsFor !== g) {
      headingsFor = g;
      headingIdx = [];
      g.els.forEach((el, i) => {
        if (el.matches('h1, h2')) headingIdx.push({ i, text: (el.textContent ?? '').trim() });
      });
    }
    minutes = minutesLeft(wordsBelowFold(g, origin, view.bottom));
    // At the very top the title is right there; no need to name it.
    section = scroll.scrollTop < 8
      ? null
      : sectionAt(headingIdx.map((h) => ({ text: h.text, top: g.tops[h.i] + origin })), view.top + view.height / 3);
  }

  $effect(() => {
    const scroll = $viewerScroll;
    const article = $currentViewerRoot;
    void $doc; // re-measure when the document (re)renders
    if (!scroll || !article) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure(scroll, article);
      });
    };
    // The blocks moved: measure them again on the next frame.
    const relayout = () => {
      invalidateReaderGeometry(article);
      schedule();
    };
    refreshReaderGeometry(article);
    measure(scroll, article);
    scroll.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', relayout);
    // Late layout changes (diagrams drawn, images loaded) move the fold.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(relayout) : null;
    ro?.observe(article);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', relayout);
      ro?.disconnect();
    };
  });
</script>

{#if minutes > 0}
  <div class="reader-meta-wrap" aria-hidden="true">
    <div class="reader-meta">
      {#if section}<span class="section">{section}</span><span class="sep">{' · '}</span>{/if}<span class="left">{minutes} min left</span>
    </div>
  </div>
{/if}

<style>
  /* Fixed over the top of the column, outside the scroller, and painted
     with nothing but its text: the page under it is the real page. Text
     scrolling up is faded out by the scroller's own top-edge mask
     (reader-mode.css), so the two never collide. The wrapper carries the
     reading size so --reader-column (em-based) matches the article. */
  .reader-meta-wrap {
    position: fixed;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: var(--reader-column);
    font-size: 1.12rem;
    z-index: 51;
    pointer-events: none;
  }
  .reader-meta {
    display: flex;
    /* Centred on the window buttons' line (38px), with the back arrow. */
    padding: 12px 48px 0;
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.4;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    white-space: pre;
  }
  .section {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .sep, .left {
    flex: none;
  }
</style>
