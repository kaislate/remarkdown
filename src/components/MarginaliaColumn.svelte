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
        style:top="{card.y - DOT_OFFSET}px"
        onclick={() => { if (!editing) startEditing(card.note.id); }}
        title={editing ? '' : 'Click to edit'}
      >
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
  /* Connector line — a static horizontal segment from the text-frame's
     right edge to the card's accent dot. Drawn via ::before so we don't
     need a separate SVG layer. */
  .note-card::before {
    content: '';
    position: absolute;
    left: -32px;
    top: 16px; /* dot center: padding-top 8 + dot margin-top 4 + dot half-height 4 */
    width: 32px;
    height: 1.5px;
    background: var(--accent);
    opacity: 0.4;
    transition: opacity 0.18s ease, height 0.18s ease;
    pointer-events: none;
  }
  /* Traveling pulse — a glowing dot that walks the connector from the
     anchor side to the card side, fading in at the start and out at
     the end so the loop reset doesn't look like a snap. Hidden under
     prefers-reduced-motion. */
  .note-card::after {
    content: '';
    position: absolute;
    left: -32px;
    top: 13px;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--accent);
    box-shadow: 0 0 8px rgba(139, 127, 255, 0.85);
    pointer-events: none;
    animation: connectorTravel 2.2s linear infinite;
  }
  @keyframes connectorTravel {
    0%   { transform: translateX(0);   opacity: 0; }
    12%  { opacity: 1; }
    88%  { opacity: 1; }
    100% { transform: translateX(32px); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .note-card::after { display: none; }
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
  .note-card:hover::after {
    animation-duration: 1.4s;
  }
  .note-card.editing {
    background: var(--bg-2);
    border-color: var(--accent-soft);
    cursor: default;
  }
  .note-card.editing::before {
    opacity: 1;
    height: 2px;
  }
  /* While editing, the traveling pulse runs ~3x as fast and the dot
     glows brighter — reads as 'this connection is active'. */
  .note-card.editing::after {
    animation-duration: 0.7s;
    box-shadow: 0 0 12px rgba(139, 127, 255, 1);
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
