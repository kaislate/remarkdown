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

  import { resolvedAnnots, currentViewerRoot, updateAnnotation } from '../stores/annots';
  import { settings } from '../stores/settings';
  import { zoomLevel } from '../stores/ui';
  import { doc } from '../stores/doc';
  import type { Note } from '../lib/schema';

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
    /** Distance in px from the anchor's right edge (= where the
     *  in-document .note-pin lives) to the card's left edge. The
     *  connector stream spans this whole distance. */
    connectorWidth: number;
    /** Visual size in px of the in-document .note-pin (computed from
     *  the article's font-size since .note-pin uses 0.7em). The
     *  trailing dot in the stream grows to match this size. */
    pinSize: number;
    anchorText: string;
  }

  /** How many dots ride the connector at once. Higher = more of a
   *  dotted-line look; lower = sparser stream. */
  const STREAM_DOTS = 5;

  const cards = $derived.by((): Card[] => {
    void resizeTick;
    const root = $currentViewerRoot;
    const container = containerEl;
    if (!root || !container) return [];

    const containerRect = container.getBoundingClientRect();
    // Compute the pin's visual centre from the article's font-size +
    // the em offsets baked into NoteLayer's .note-pin CSS:
    //   - position top = rangeRect.bottom (CSS top property)
    //   - margin-top: -0.55em (shifts up)
    //   - height: 0.7em (so half-height = 0.35em)
    //   ⇒ visual centre Y = rangeRect.bottom - 0.55em + 0.35em
    //                     = rangeRect.bottom - 0.2em
    //   - position left = rangeRect.right
    //   - margin-left: -0.35em + half-width 0.35em ⇒ centre X = rangeRect.right
    // Doing the math here (not querySelector) means the orb lines up
    // with the pin even before NoteLayer has flushed its render.
    const articleFontSize = parseFloat(getComputedStyle(root).fontSize) || 17;
    const pinCenterDy = articleFontSize * 0.2;
    const pinSize = articleFontSize * 0.7;

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
        const originX = rangeRect.right;
        const originY = rangeRect.bottom - pinCenterDy;
        // Floor at 32 so an anchor that ends very close to the
        // text-frame's right edge still gets a visible connector.
        const gap = Math.max(32, containerRect.left - originX);
        return {
          note,
          y: originY - containerRect.top,
          connectorWidth: gap,
          pinSize,
          anchorText: note.anchor.text,
        };
      });
  });

  // Inline-edit state — only one card can be in edit mode at a time.
  let editingId = $state<string | null>(null);
  let editingTextarea = $state<HTMLTextAreaElement | null>(null);

  // Autofocus the textarea (and select-all) the moment edit mode opens
  // for any card. The bind:this catches the textarea ref on mount.
  // preventScroll is critical: the textarea sits at its card's
  // anchor-y inside the scrolling article, so a default focus() would
  // make the browser scroll the article to bring it into view —
  // exactly the "click moved my scroll down" symptom this avoids.
  $effect(() => {
    void editingId;
    if (editingTextarea) {
      editingTextarea.focus({ preventScroll: true });
      editingTextarea.select();
    }
  });

  function startEditing(noteId: string) {
    editingId = noteId;
  }

  function commitAndExit() {
    editingId = null;
  }

  function onEditKeydown(e: KeyboardEvent) {
    // Enter (without Shift) or Escape commits + closes. Shift+Enter
    // inserts a newline (default behaviour, no preventDefault).
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      (e.currentTarget as HTMLTextAreaElement).blur();
    }
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
      {@const editing = editingId === card.note.id}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="note-card"
        class:editing
        style="top: {card.y - DOT_OFFSET}px; --connector-width: {card.connectorWidth}px; --pin-size: {card.pinSize}px;"
        onclick={() => { if (!editing) startEditing(card.note.id); }}
        title={editing ? '' : 'Click to edit'}
      >
        {#if editing}
          <!-- Stream of dots flowing from the card toward the in-doc
               pin. Dots grow as they approach the pin (eventually
               matching its size). Only mounted while editing. -->
          <div class="connector-stream" aria-hidden="true">
            {#each Array(STREAM_DOTS) as _, i}
              <div class="stream-dot" style="--phase: {i / STREAM_DOTS};"></div>
            {/each}
          </div>
        {/if}
        <span class="dot" aria-hidden="true"></span>
        <div class="text">
          <div class="quote">{card.anchorText}</div>
          {#if editing}
            <textarea
              bind:this={editingTextarea}
              class="edit-input"
              aria-label="Edit re.mark body"
              placeholder="Write a re.mark…"
              value={card.note.body}
              oninput={(e) => updateAnnotation(card.note.id, (a) => ({ ...(a as Note), body: (e.currentTarget as HTMLTextAreaElement).value }))}
              onblur={commitAndExit}
              onkeydown={onEditKeydown}
              onclick={(e) => e.stopPropagation()}
              rows="3"
            ></textarea>
          {:else if card.note.body}
            <div class="body">{card.note.body}</div>
          {:else}
            <div class="body empty">(empty re.mark — click to add)</div>
          {/if}
        </div>
      </div>
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
  /* Connector stream — a flow of luminous dots from the card toward
     the in-document pin, mounted only while the card is in edit mode.
     The wrapper spans the gap (right:100% + width:--connector-width).
     Dots are absolutely positioned within and animated leftward. */
  .connector-stream {
    position: absolute;
    right: 100%;
    top: 0;
    bottom: 0;
    width: var(--connector-width, 32px);
    pointer-events: none;
  }

  /* Each dot starts max-sized at the card edge and travels left
     toward the pin. As it travels, scale grows from 0.18 to 1.0
     (where 1.0 = .note-pin's actual size, set as --pin-size on the
     parent card). The visual: dots GROW from card-side specks into
     the pin-sized dot, then merge into the pin and vanish.
     STREAM_DOTS instances are staggered via per-dot --phase so the
     stream looks continuous. */
  .stream-dot {
    position: absolute;
    /* Vertical: centre on the connector line (which sits at top:16
       from card top — same y as the card's accent dot). */
    top: calc(16px - var(--pin-size, 12px) / 2);
    /* Initial position: dot's centre at the card's left edge. */
    right: calc(var(--pin-size, 12px) / -2);
    width: var(--pin-size, 12px);
    height: var(--pin-size, 12px);
    border-radius: 999px;
    background: radial-gradient(
      circle at 32% 30%,
      rgba(255, 255, 255, 0.92) 0%,
      var(--accent) 40%,
      rgba(139, 127, 255, 0.85) 100%
    );
    box-shadow:
      0 0 6px rgba(139, 127, 255, 0.55),
      0 0 14px rgba(139, 127, 255, 0.28);
    filter: blur(0.35px);
    animation: streamFlow 2.4s linear infinite;
    /* Negative delay = animation has 'already been running' for
       phase * duration when it starts. Spaces the dots evenly along
       the connector. */
    animation-delay: calc(var(--phase, 0) * -2.4s);
  }
  @keyframes streamFlow {
    0%   { transform: translateX(0)                                       scale(0.18); opacity: 0; }
    8%   {                                                                              opacity: 1; }
    92%  {                                                                              opacity: 1; }
    100% { transform: translateX(calc(var(--connector-width, 32px) * -1)) scale(1);    opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .connector-stream { display: none; }
  }
  .note-card:hover {
    background: var(--bg-2);
    border-color: var(--accent-soft);
    transform: translateX(-2px);
  }
  .note-card.editing {
    background: var(--bg-2);
    border-color: var(--accent-soft);
    cursor: default;
  }

  /* Inline-edit textarea — handwritten font like the popover so the
     edit experience feels continuous with the existing in-doc note
     editor. Replaces .body when the card is in edit mode. */
  .edit-input {
    background: rgba(0, 0, 0, 0.18);
    color: var(--fg-0);
    border: 1px solid var(--accent-soft);
    border-radius: 6px;
    padding: 6px 8px;
    font-family:
      'Segoe Print',
      'Patrick Hand',
      'Architects Daughter',
      'Kalam',
      'Indie Flower',
      'Comic Sans MS',
      'Bradley Hand',
      'Marker Felt',
      cursive;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    resize: vertical;
    min-height: 60px;
    outline: none;
    transition: border-color 0.15s ease;
  }
  .edit-input::placeholder {
    color: var(--fg-2);
    font-weight: 500;
  }
  .edit-input:focus {
    border-color: var(--accent);
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
