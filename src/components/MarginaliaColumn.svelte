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
    // y is in container coords (which match article-top coords). Scroll
    // so the anchor lands ~25% from the top of the viewport.
    const margin = scrollEl.clientHeight * 0.25;
    const targetScroll = scrollEl.scrollTop + y - margin;
    scrollEl.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
  }
</script>

{#if $doc !== null && $settings.marginaliaEnabled}
  <div class="marginalia" bind:this={containerEl} aria-label="re.marks marginalia">
    {#each cards as card (card.note.id)}
      <button
        class="note-card"
        style:top="{card.y}px"
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
    right: 0;
    bottom: 0;
    width: 280px;
    pointer-events: none;
    /* Hide on narrower viewports — there isn't enough horizontal room
       to clear the article column without overlap. The setting can be
       on, the column simply waits for window width. */
    display: none;
  }
  @media (min-width: 1440px) {
    .marginalia {
      display: block;
    }
  }

  .note-card {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: auto;
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
    transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
  }
  .note-card:hover {
    background: var(--bg-2);
    border-color: var(--accent-soft);
    transform: translateX(-2px);
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
