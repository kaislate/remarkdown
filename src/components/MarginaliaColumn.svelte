<script lang="ts">
  // Right-margin marginalia column — read-only prototype.
  // Renders one card per resolved re.mark, vertically aligned with the
  // anchor's y-position in the article. Cards live inside .content
  // (sibling of .text-frame) so they scroll naturally with the article;
  // only their y is computed from anchor positions.
  //
  // Visibility:
  // - Setting `marginaliaEnabled` must be on
  // - Viewport must be ≥ 1440px wide (CSS @media; otherwise the column
  //   would either overlap the text or get clipped by the minimap pad)
  //
  // Known prototype gaps:
  // - No collision avoidance — cards anchored close together overlap
  // - No connection lines yet
  // - Read-only (no inline editing)

  import { resolvedAnnots, currentViewerRoot } from '../stores/annots';
  import { settings } from '../stores/settings';
  import { zoomLevel } from '../stores/ui';
  import { doc } from '../stores/doc';
  import { viewerScroll } from '../stores/viewport';
  import type { Note } from '../lib/schema';
  import { get } from 'svelte/store';

  let containerEl = $state<HTMLDivElement | null>(null);
  let resizeTick = $state(0);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => { resizeTick += 1; };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Layout-affecting settings change → defer one frame so getBoundingClientRect
  // sees the new layout before we recompute anchor positions.
  $effect(() => {
    void $zoomLevel;
    void $settings.articleWidth;
    if (typeof requestAnimationFrame === 'undefined') {
      resizeTick += 1;
      return;
    }
    const id = requestAnimationFrame(() => { resizeTick += 1; });
    return () => cancelAnimationFrame(id);
  });

  interface Card {
    note: Note;
    y: number;
    anchorText: string;
  }

  const cards = $derived.by((): Card[] => {
    void resizeTick;
    const root = $currentViewerRoot;
    const container = containerEl;
    if (!root || !container) return [];

    const containerRect = container.getBoundingClientRect();

    return $resolvedAnnots
      .filter((r) => r.annotation.type === 'note')
      .map((r) => {
        const note = r.annotation as Note;
        let rangeRect: DOMRect;
        try {
          rangeRect = r.range.getBoundingClientRect();
        } catch {
          rangeRect = new DOMRect(0, 0, 0, 0);
        }
        return {
          note,
          y: rangeRect.top - containerRect.top,
          anchorText: note.anchor.text,
        };
      });
  });

  function jumpTo(y: number) {
    const scrollEl = get(viewerScroll);
    if (!scrollEl) return;
    // y is the anchor's offset from .content top (computed when the
    // cards array derives) — invariant of current scroll position. To
    // park the anchor ~25% from the viewport top, set scrollTop to
    // y - margin. Adding scrollEl.scrollTop on top would double-count
    // the current scroll and overshoot past the anchor.
    const margin = scrollEl.clientHeight * 0.25;
    const targetScroll = y - margin;
    scrollEl.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
  }

  // Card top is offset upward by DOT_OFFSET so the card's accent dot
  // (which is what the connector line attaches to) sits at exactly the
  // anchor's y. Card padding-top (8) + dot margin-top (4) + dot
  // half-height (4) = 16.
  const DOT_OFFSET = 16;
</script>

{#if $doc !== null && $settings.marginaliaEnabled}
  <div class="marginalia" bind:this={containerEl} aria-label="re.marks marginalia">
    {#each cards as card (card.note.id)}
      <button
        class="note-card"
        style:top="{card.y - DOT_OFFSET}px"
        onclick={() => jumpTo(card.y)}
        title={card.anchorText}
      >
        <span class="dot" aria-hidden="true"></span>
        <div class="text">
          <div class="quote">{card.anchorText}</div>
          {#if card.note.body}
            <div class="body">{card.note.body}</div>
          {:else}
            <div class="body empty">(empty re.mark)</div>
          {/if}
        </div>
      </button>
    {/each}
  </div>
{/if}

<style>
  .marginalia {
    position: absolute;
    top: 0;
    /* Sit just to the right of the text-frame with a 32px gap that
       doubles as the connector-line track. left:100% means our left
       edge lands at the text-frame's right edge; the 32px gap is
       added via padding/margin trick — actually via margin-left so
       the cards measure inside this 280px width. */
    left: 100%;
    margin-left: 32px;
    bottom: 0;
    width: 280px;
    /* No display:none gate — clipping handles overflow at narrow
       viewports gracefully. .scroll has overflow-x:hidden so anything
       past the right edge of the scroll container is cropped. */
  }

  .note-card {
    position: absolute;
    left: 0;
    right: 0;
    background: var(--bg-1);
    border: 1px solid var(--glass-border);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    padding: 8px 10px;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    color: var(--fg-1);
    display: flex;
    gap: 8px;
    transition: background 0.12s ease, border-color 0.12s ease, transform 0.18s ease;
  }
  /* Connector line — a horizontal segment from the text-frame's right
     edge to the card's accent dot. Drawn via ::before so we don't need
     a separate SVG layer. The line's width (32px) matches the gap
     between text-frame and marginalia, so it spans exactly the gutter
     and meets the card's left edge. */
  .note-card::before {
    content: '';
    position: absolute;
    left: -32px;
    top: 16px; /* dot center: padding-top 8 + dot margin-top 4 + dot half-height 4 */
    width: 32px;
    height: 1.5px;
    background: var(--accent);
    opacity: 0.32;
    transform-origin: right center;
    transition: opacity 0.18s ease, height 0.18s ease;
    pointer-events: none;
  }
  .note-card:hover {
    background: var(--bg-2);
    border-color: var(--accent-soft);
    transform: translateX(-2px);
  }
  .note-card:hover::before {
    opacity: 1;
    height: 2px;
  }
  /* Subtle ambient pulse on the connector so the panel reads as
     'alive' even before hover. Slow + low-contrast so it's atmosphere,
     not distraction. */
  @media (prefers-reduced-motion: no-preference) {
    .note-card::before {
      animation: connectorPulse 3.6s ease-in-out infinite;
    }
  }
  @keyframes connectorPulse {
    0%, 100% { opacity: 0.28; }
    50%      { opacity: 0.5; }
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
    gap: 4px;
  }
  .quote {
    color: var(--fg-2);
    font-size: 11px;
    font-style: italic;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .body {
    color: var(--fg-0);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .body.empty {
    color: var(--fg-2);
    font-weight: 400;
    font-style: italic;
  }
</style>
