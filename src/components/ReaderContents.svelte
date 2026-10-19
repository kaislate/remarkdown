<script lang="ts">
  // Reader mode's contents list ("Section and time left: Contents on the
  // left"): the document's headings in a quiet column left of the page, the
  // one being read marked, each a way to jump there, and the minutes left
  // underneath. It takes the place of the meta line at the top
  // (ReaderMeta); in a window too narrow to fit it beside the column, the
  // meta line comes back instead (reader-mode.css).
  import { tick, untrack } from 'svelte';
  import { viewerScroll } from '../stores/viewport';
  import { currentViewerRoot } from '../stores/annots';
  import { doc } from '../stores/doc';
  import { countWords, wordsBelow, minutesLeft } from '../lib/reading-time';

  interface Entry { el: HTMLElement; text: string; level: number }

  let entries = $state<Entry[]>([]);
  let current = $state(-1);
  let minutes = $state(0);
  let listEl = $state<HTMLElement | null>(null);

  const wordCache = new WeakMap<Element, number>();
  function wordsIn(el: Element): number {
    let n = wordCache.get(el);
    if (n === undefined) {
      n = el.matches('.mermaid-block, .mermaid-error') ? 0 : countWords(el.textContent ?? '');
      wordCache.set(el, n);
    }
    return n;
  }

  function collect(article: HTMLElement): void {
    entries = Array.from(article.querySelectorAll<HTMLElement>(':scope > h1, :scope > h2, :scope > h3')).map((el) => ({
      el,
      text: (el.textContent ?? '').trim(),
      level: Number(el.tagName.charAt(1)),
    }));
  }

  // Same rule as the meta line: the section being read is the last heading
  // that has come up to the reading line, a third of the way down.
  function measure(scroll: HTMLElement, article: HTMLElement): void {
    const view = scroll.getBoundingClientRect();
    const line = view.top + view.height / 3;
    let at = -1;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].el.getBoundingClientRect().top > line) break;
      at = i;
    }
    if (at !== current) {
      current = at;
      void tick().then(() => {
        listEl?.querySelector<HTMLElement>('[aria-current]')?.scrollIntoView({ block: 'nearest' });
      });
    }
    const blocks = Array.from(article.children).map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, words: wordsIn(el) };
    });
    minutes = minutesLeft(wordsBelow(blocks, view.bottom));
  }

  $effect(() => {
    const scroll = $viewerScroll;
    const article = $currentViewerRoot;
    void $doc; // re-collect when the document (re)renders
    if (!scroll || !article) return;
    // collect/measure read and write this component's own state; keep that
    // out of the effect's dependencies or every update would re-run it.
    untrack(() => collect(article));
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure(scroll, article);
      });
    };
    untrack(() => measure(scroll, article));
    scroll.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(article);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  });

  function jump(e: MouseEvent, entry: Entry): void {
    e.preventDefault();
    const scroll = $viewerScroll;
    if (!scroll) return;
    const top = entry.el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    // A little air above the heading; the very first one goes to the top.
    scroll.scrollTo({ top: entry === entries[0] ? 0 : Math.max(0, top - 56) });
  }
</script>

{#if entries.length > 0}
  <nav class="reader-contents" aria-label="Contents">
    <ol bind:this={listEl}>
      {#each entries as entry, i (entry.el)}
        <li class={`level-${entry.level}`}>
          <a
            href={`#${entry.el.id}`}
            aria-current={i === current ? 'location' : undefined}
            onclick={(e) => jump(e, entry)}
          >{entry.text}</a>
        </li>
      {/each}
    </ol>
    {#if minutes > 0}<p class="left">{minutes} min left</p>{/if}
  </nav>
{/if}

<style>
  /* Left of the reader column, below the back arrow. Painted with nothing
     but its text, in the reader theme's ink. */
  .reader-contents {
    position: fixed;
    top: 56px;
    left: 28px;
    width: 200px;
    max-height: calc(100vh - 112px);
    z-index: 52;
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-family: var(--font-sans);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    scrollbar-width: none;
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 16px), transparent);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 16px), transparent);
  }
  ol::-webkit-scrollbar { display: none; }
  a {
    display: block;
    padding: 5px 10px;
    border-left: 2px solid transparent;
    color: var(--fg-2);
    font-size: 12.5px;
    line-height: 1.35;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.18s ease, border-color 0.18s ease;
  }
  .level-3 a { padding-left: 22px; font-size: 12px; }
  a:hover { color: var(--fg-0); }
  a[aria-current] {
    color: var(--fg-0);
    border-left-color: var(--accent);
  }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .left {
    margin: 0;
    padding-left: 12px;
    color: var(--fg-2);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
</style>
