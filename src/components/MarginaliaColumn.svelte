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
  import { contextFor } from '../lib/note-context';
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
    /** Sentence(s) of context around the anchor, built via
     *  buildSentenceContext using the same `remarkContextSentences`
     *  + `remarkContextStopAtParagraph` settings as the bottom-left
     *  re.marks panel. Falls back to the anchor's quoted text if
     *  context can't be computed (e.g., anchor not inside a block). */
    context: string;
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
          context: contextFor(r.range, root, {
            sentences: $settings.remarkContextSentences,
            stopAtParagraph: $settings.remarkContextStopAtParagraph,
            stopAtListItem: $settings.remarkContextStopAtListItem,
          }) || note.anchor.text,
        };
      })
      // Sort by y so earlier (top-of-page) cards render later in the
      // {#each}, which combined with the explicit z-index below means
      // they overlay later cards when y-ranges collide.
      .sort((a, b) => a.y - b.y);
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
    {#each cards as card, i (card.note.id)}
      {@const editing = editingId === card.note.id}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="note-card"
        class:editing
        style="
          top: {card.y - DOT_OFFSET}px;
          --connector-width: {card.connectorWidth}px;
          --pin-size: {card.pinSize}px;
          z-index: {editing ? 1000 : cards.length - i};
        "
        onclick={() => { if (!editing) startEditing(card.note.id); }}
        title={editing ? '' : card.context}
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
          <div class="quote">{card.context}</div>
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

  /* Liquid-glass card with 2.5D 'waterfall' edges.
     No stroked border — edges are defined entirely by:
       - radial top-left highlight (light catching the rim curve)
       - radial bottom-right vignette (surface curves into shadow)
       - layered inset shadows that simulate a beveled glass edge
       - an offset drop shadow (down + right) for grounded depth
     Connector-stream relies on visible overflow to draw past the
     card's left edge into the article gutter. */
  .note-card {
    position: absolute;
    left: 0;
    right: 0;
    background:
      /* Top-left rim highlight — strong, simulates the bevel
         catching an imagined light source above-left. */
      radial-gradient(
        ellipse 95% 65% at 6% 6%,
        rgba(255, 255, 255, 0.22) 0%,
        rgba(255, 255, 255, 0) 58%
      ),
      /* Bottom-right vignette — the surface bevels away into shadow. */
      radial-gradient(
        ellipse 65% 55% at 96% 96%,
        rgba(0, 0, 0, 0.18) 0%,
        rgba(0, 0, 0, 0) 60%
      ),
      /* Diagonal sheen */
      linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.06) 0%,
        rgba(255, 255, 255, 0.01) 32%,
        rgba(0, 0, 0, 0.02) 68%,
        rgba(0, 0, 0, 0.10) 100%
      ),
      /* Accent-purple identity tint */
      linear-gradient(
        140deg,
        rgba(139, 127, 255, 0.10) 0%,
        rgba(139, 127, 255, 0.03) 100%
      ),
      /* Translucent dark base */
      rgba(20, 18, 30, 0.55);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 0;
    border-radius: 18px;
    padding: 12px 14px;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    color: var(--fg-1);
    display: flex;
    gap: 8px;
    /* Soft bevel only — no sharp 1px rim lines (they read as a
       stroke). Edges are defined by:
       - the radial highlight + vignette in the background
       - blurred inset shadows that fade smoothly inward
       - the offset drop shadow giving depth.
       No outline-like lines anywhere. */
    box-shadow:
      inset 4px 4px 10px rgba(255, 255, 255, 0.10),
      inset -4px -4px 12px rgba(0, 0, 0, 0.22),
      8px 12px 26px rgba(0, 0, 0, 0.55);
    transition:
      transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.28s ease;
  }
  /* No left accent rail — the accent-purple wash in the background
     gradient carries the brand identity without needing a hard line. */
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
  /* Hover: lift up + left, deepen the bevel + drop shadow.
     Same no-lines treatment as default. */
  .note-card:hover {
    transform: translateX(-3px) translateY(-2px);
    box-shadow:
      inset 4px 4px 12px rgba(255, 255, 255, 0.13),
      inset -4px -4px 14px rgba(0, 0, 0, 0.24),
      10px 16px 32px rgba(0, 0, 0, 0.6);
  }

  /* Editing: bigger lift, deeper drop shadow. No accent border or
     halo glow — the writing surface inside the card carries the
     'live' signal instead. */
  .note-card.editing {
    cursor: default;
    transform: translateX(-3px) translateY(-2px);
    box-shadow:
      inset 4px 4px 12px rgba(255, 255, 255, 0.15),
      inset -4px -4px 14px rgba(0, 0, 0, 0.26),
      12px 18px 36px rgba(0, 0, 0, 0.6);
  }

  /* Inline-edit textarea — handwritten font like the popover so the
     edit experience feels continuous with the existing in-doc note
     editor. Replaces .body when the card is in edit mode. */
  /* Skeuomorphic writing surface — feels like a recessed notepad
     carved into the glass card, not a plain textarea.
     - Faint horizontal ruling (repeating gradient at line-height
       intervals) for paper feel
     - Inset shadows simulate depression below the card surface
     - Warm dark base + diagonal sheen for depth
     - Custom accent caret + selection
     - Slide-in animation on appear (penDown spring) */
  .edit-input {
    background:
      /* Paper ruling — every 20px, faint accent-purple line */
      repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 19px,
        rgba(139, 127, 255, 0.10) 19px,
        rgba(139, 127, 255, 0.10) 20px
      ),
      /* Inner sheen for surface depth */
      linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.02) 0%,
        rgba(0, 0, 0, 0.14) 100%
      ),
      /* Deep warm-dark base — much darker than the card surface so
         the depression contrast reads clearly. */
      rgba(8, 6, 14, 0.78);
    color: var(--fg-0);
    caret-color: var(--accent);
    border: 0;
    /* Highly rounded corners — feels like a pocket carved into the
       cushion of the card. */
    border-radius: 14px;
    /* Deep inset depression. The shadows on top + both sides simulate
       a real recess below the card surface; the bottom inset
       highlight catches the imagined light returning from inside the
       depression. No outer border. */
    box-shadow:
      inset 0 3px 6px rgba(0, 0, 0, 0.55),
      inset 0 1px 2px rgba(0, 0, 0, 0.4),
      inset 2px 0 4px rgba(0, 0, 0, 0.3),
      inset -2px 0 3px rgba(0, 0, 0, 0.25),
      inset 0 -2px 2px rgba(0, 0, 0, 0.2),
      inset 0 -1px 0 rgba(255, 255, 255, 0.08);
    padding: 10px 12px;
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
    font-size: 14px;
    font-weight: 600;
    line-height: 20px; /* matches ruling spacing so text sits ON the lines */
    letter-spacing: 0.01em;
    resize: vertical;
    min-height: 60px;
    outline: none;
    transition: box-shadow 0.18s ease;
    animation: penDown 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .edit-input::placeholder {
    color: var(--fg-2);
    font-weight: 500;
    font-style: italic;
  }
  .edit-input::selection {
    background: rgba(139, 127, 255, 0.35);
    color: var(--fg-0);
  }
  .edit-input:focus {
    box-shadow:
      inset 0 3px 7px rgba(0, 0, 0, 0.6),
      inset 0 1px 2px rgba(0, 0, 0, 0.45),
      inset 2px 0 4px rgba(0, 0, 0, 0.32),
      inset -2px 0 3px rgba(0, 0, 0, 0.27),
      inset 0 -2px 2px rgba(0, 0, 0, 0.22),
      inset 0 -1px 0 rgba(255, 255, 255, 0.10),
      /* Subtle accent-purple inner ring on focus, mimicking pen ink
         around the active writing area without a hard border */
      inset 0 0 0 1px rgba(139, 127, 255, 0.35);
  }
  /* Pen-down: textarea slides in from slightly above + fades, with
     overshoot spring so it 'sets' in place. */
  @keyframes penDown {
    0%   { transform: translateY(-3px); opacity: 0; }
    100% { transform: translateY(0);     opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .edit-input { animation: none; }
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
  /* Sentence context — longer text now (full sentence(s) around the
     anchor, not just the quoted word). 4-line clamp accommodates a
     2-sentence setting comfortably; longer settings ellipsis at the
     edge. The native title attr exposes the full text on hover. */
  .quote {
    color: var(--fg-2);
    font-size: 11px;
    font-style: italic;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
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
