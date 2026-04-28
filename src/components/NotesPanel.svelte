<script lang="ts">
  import { resolvedAnnots, currentViewerRoot } from '../stores/annots';
  import { viewerScroll } from '../stores/viewport';
  import { doc } from '../stores/doc';
  import { settings } from '../stores/settings';
  import { buildSentenceContext } from '../lib/sentence-context';
  import type { Note } from '../lib/schema';

  let open = $state(false);

  // Compute the anchor's character offset within its containing block,
  // by walking text nodes in the block until we hit the range's start.
  function anchorOffsetWithinBlock(range: Range, block: HTMLElement): number | null {
    let acc = 0;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      if (n === range.startContainer) {
        return acc + range.startOffset;
      }
      acc += (n as Text).data.length;
      n = walker.nextNode();
    }
    return null;
  }

  // Build the display context for a single re.mark: the anchor's
  // sentence plus settings.remarkContextSentences-1 preceding ones.
  // If remarkContextStopAtParagraph is false, the walk crosses block
  // boundaries to fill the budget.
  function contextFor(range: Range): string {
    const root = $currentViewerRoot;
    if (!root) return '';
    const startEl = (range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as Element));
    const block = startEl?.closest<HTMLElement>('[data-block-id]');
    if (!block) return '';
    const anchorOffset = anchorOffsetWithinBlock(range, block);
    if (anchorOffset === null) return block.textContent ?? '';

    const blocks = $settings.remarkContextStopAtParagraph
      ? [block]
      : (() => {
          const all = Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'));
          const idx = all.indexOf(block);
          return idx < 0 ? [block] : all.slice(0, idx + 1);
        })();
    const blockTexts = blocks.map((b) => b.textContent ?? '');

    return buildSentenceContext(
      blockTexts,
      anchorOffset,
      $settings.remarkContextSentences,
      $settings.remarkContextStopAtParagraph,
    );
  }

  // Resolved notes only — orphaned notes live in their own panel and
  // can't be jumped-to anyway.
  const notes = $derived(
    $resolvedAnnots
      .filter((r) => r.annotation.type === 'note')
      .map((r) => ({
        note: r.annotation as Note,
        range: r.range,
        context: contextFor(r.range),
      })),
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
    if (target?.closest?.('.notes-pill-wrap, .notes-popup-wrap')) return;
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

{#if $doc !== null}
  <div class="notes-pill-wrap">
    <button
      class="pill glass glass-pill"
      aria-label={open
        ? 'Close re.marks panel'
        : `Open re.marks panel (${notes.length} ${notes.length === 1 ? 'note' : 'notes'})`}
      aria-expanded={open}
      title={`re.marks (${notes.length})`}
      onclick={() => (open = !open)}
    >
      <span class="wordmark">re<span class="brand-dot">.</span>marks</span>
      {#if notes.length > 0}
        <span class="count">{notes.length}</span>
      {/if}
    </button>
  </div>

  {#if open}
    <div class="notes-popup-wrap">
      <div class="popup glass" role="dialog" aria-label="re.marks">
        <header>
          <h3>re<span class="brand-dot">.</span>marks{notes.length > 0 ? ` (${notes.length})` : ''}</h3>
        </header>
        {#if notes.length === 0}
          <p class="empty-state">
            No re.marks yet. Pick the re.mark tool (or press <kbd>3</kbd>),
            then click somewhere in the text.
          </p>
        {:else}
          <ul>
            {#each notes as n (n.note.id)}
              <li>
                <button class="note-row" onclick={() => jumpTo(n.range)}>
                  <span class="dot" aria-hidden="true"></span>
                  <div class="text">
                    <div class="quote">{n.context || excerpt(n.note.anchor.text)}</div>
                    {#if n.note.body}
                      <div class="body">{excerpt(n.note.body, 120)}</div>
                    {:else}
                      <div class="body empty">(empty re.mark)</div>
                    {/if}
                  </div>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
{/if}

<style>
  /* Sits to the LEFT of the ToC button (left:144), with an 8px gap.
     We anchor the pill's RIGHT edge at 136px from the viewport's left
     so the gap stays consistent regardless of how wide the wordmark +
     count grow. Same vertical level (bottom:68) so the two read as a
     "navigation tools" cluster above the bottom-left zoom + Focus
     stack.
     z-index 110 puts the wrap above WelcomeDismiss (z:100) so the
     expanding popup doesn't get visually covered by the dismiss text
     when both are visible at the same time. */
  .notes-pill-wrap {
    position: fixed;
    bottom: 68px;
    right: calc(100% - 136px);
    z-index: 110;
  }
  /* The popup is wider (360px) than the gap between the pill and the
     left edge of the screen, so it can't expand straight up from the
     pill without clipping. Instead, anchor it at the same x as the
     zoom controls (left:22) and float it above the pill row. */
  .notes-popup-wrap {
    position: fixed;
    /* pill bottom 68 + pill height 38 + 8px gap = 114 */
    bottom: 114px;
    left: 22px;
    z-index: 110;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    /* Match the ToC button's 38px height so the two pills sit on the
       same baseline. Padding tuned to keep the wordmark optically
       centred at the new height. */
    padding: 8px 16px;
    height: 38px;
    background: var(--glass-fill);
    border: 1px solid var(--glass-border);
    color: var(--fg-1);
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
  /* "re.marks" wordmark — same typography + accent dot as the re.md
     mark next to the hamburger, just shorter. Consistent brand
     vocabulary for "the place your annotations live".

     inline-block + position:relative gives the orbiting dot a
     containing block to position against. isolation: isolate creates
     a stacking context so the orbit's z-index:-1 stays ABOVE the
     pill's glass background (which lives outside this context) but
     BELOW the inline letters of "re.marks" — that's how the dot can
     pass behind the text without falling out the back of the pill. */
  .wordmark {
    display: inline-block;
    position: relative;
    isolation: isolate;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1;
    color: inherit;
  }
  /* At rest the dot is the literal "." character. On hover (or while
     the popup is open) the period fades out and a ::after pseudo on
     .wordmark takes its place — orbiting the entire word, passing in
     front of the text on the lower half of the orbit and behind it
     on the upper half. */
  .brand-dot {
    color: var(--accent);
    transition: color 0.2s ease;
  }
  .pill:hover .brand-dot,
  .pill[aria-expanded='true'] .brand-dot {
    color: transparent;
  }

  /* Orbiting dot. The animation always runs but is paused at rest
     and only fades in on hover/open, so the pill is dormant when not
     interacted with and the dot picks up at a sensible orbit
     position when the user re-hovers. */
  .wordmark::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border-radius: 999px;
    background: var(--accent);
    box-shadow: 0 1px 3px rgba(139, 127, 255, 0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
    animation:
      orbit 4.5s linear infinite paused,
      orbitDepth 4.5s steps(2, jump-none) infinite paused;
  }
  .pill:hover .wordmark::after,
  .pill[aria-expanded='true'] .wordmark::after {
    opacity: 1;
    animation-play-state: running, running;
  }

  /* Elliptical orbit (rx=40, ry≈9) traced by an animated transform
     chain. The trick: scaleY(0.225) on the OUTSIDE squashes the
     rotation into an ellipse so the orbit fits inside the pill's
     38px height; scaleY(4.44) on the INSIDE pre-stretches the dot
     so it ends up a perfect circle once the outer squash applies.
     The two cancel for axis-aligned points and the dot's bounding
     box stays a constant 8x8 throughout the orbit. */
  @keyframes orbit {
    from { transform: scaleY(0.225) rotate(0deg)   translate(40px, 0) rotate(0deg)   scaleY(4.44); }
    to   { transform: scaleY(0.225) rotate(360deg) translate(40px, 0) rotate(-360deg) scaleY(4.44); }
  }

  /* Depth flip at the side crossings of the orbit. Going clockwise
     from 3 o'clock:
       0% .. 50%  — front half (passes through 6 o'clock, below text)
       50% .. 100% — back half (passes through 12 o'clock, above text)
     `steps(2, jump-none)` gives a clean discrete jump at exactly 50%
     instead of integer-interpolating z-index across the whole cycle. */
  @keyframes orbitDepth {
    0%   { z-index: 2; }
    100% { z-index: -1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .wordmark::after { animation: none; }
  }
  .count {
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }

  /* The popup uses the same translucent + backdrop-filtered look as
     the hamburger menu (via the .glass class on the element).
     Background, border, blur, shadow, and border-radius all come from
     .glass — we only set sizing + layout here. */
  .popup {
    width: min(360px, calc(100vw - 44px));
    max-height: min(420px, 60vh);
    padding: 6px;
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 6px 8px;
  }
  h3 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg-1);
  }
  /* The brand-dot in the popup header matches the dot in the pill so
     the popup reads as a continuation of the wordmark. */
  h3 .brand-dot {
    color: var(--accent);
  }
  .empty-state {
    margin: 4px 8px 8px;
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg-2);
  }
  .empty-state kbd {
    background: var(--bg-2);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-1);
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
  /* Quote can span multiple lines now that it carries sentence context.
     Cap at three lines with line-clamp ellipsis so a verbose 5-sentence
     setting still renders compactly. */
  .quote {
    color: var(--fg-2);
    font-size: 11px;
    font-style: italic;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .body {
    color: var(--fg-0);
    font-weight: 500;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .body.empty {
    color: var(--fg-2);
    font-weight: 400;
    font-style: italic;
  }
</style>
