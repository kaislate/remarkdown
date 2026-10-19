<script lang="ts">
  // Reader mode's small meta line at the top of the column:
  // "Chapter 3 · 6 min left". The time is the words still below the
  // viewport at ~230 wpm; the section is the last heading that has
  // scrolled by. Both follow the scroll position. Hidden once there is
  // nothing left to read.
  import { viewerScroll } from '../stores/viewport';
  import { currentViewerRoot } from '../stores/annots';
  import { doc } from '../stores/doc';
  import { countWords, wordsBelow, minutesLeft, sectionAt } from '../lib/reading-time';

  let minutes = $state(0);
  let section = $state<string | null>(null);

  // Word counts per block, computed once per element. Diagrams are looked
  // at, not read word by word, so their labels don't count.
  const wordCache = new WeakMap<Element, number>();
  function wordsIn(el: Element): number {
    let n = wordCache.get(el);
    if (n === undefined) {
      n = el.matches('.mermaid-block, .mermaid-error') ? 0 : countWords(el.textContent ?? '');
      wordCache.set(el, n);
    }
    return n;
  }

  function measure(scroll: HTMLElement, article: HTMLElement): void {
    const view = scroll.getBoundingClientRect();
    const blocks = [];
    const headings = [];
    for (const el of Array.from(article.children)) {
      const r = el.getBoundingClientRect();
      blocks.push({ top: r.top, bottom: r.bottom, words: wordsIn(el) });
      if (el.matches('h1, h2')) headings.push({ text: (el.textContent ?? '').trim(), bottom: r.bottom });
    }
    minutes = minutesLeft(wordsBelow(blocks, view.bottom));
    section = sectionAt(headings, view.top);
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
    measure(scroll, article);
    scroll.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Late layout changes (diagrams drawn, images loaded) move the fold.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(article);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
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
  /* Sticky but zero-height, so it never moves the article (annotation
     layers position against the text frame). The line itself overlays
     the top of the column on a fade of the page colour. */
  .reader-meta-wrap {
    position: sticky;
    top: 0;
    height: 0;
    z-index: 5;
    pointer-events: none;
  }
  .reader-meta {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    padding: 22px 48px 26px;
    background: linear-gradient(var(--bg-0) 62%, transparent);
    /* Soft side edges, so the fade never reads as a box over the app's
       background glow. */
    -webkit-mask-image: linear-gradient(to right, transparent, #000 48px, #000 calc(100% - 48px), transparent);
    mask-image: linear-gradient(to right, transparent, #000 48px, #000 calc(100% - 48px), transparent);
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
