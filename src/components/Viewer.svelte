<script lang="ts">
  import { doc } from '../stores/doc';
  import { currentViewerRoot, annots, updateAnnotation } from '../stores/annots';
  import { viewerScroll } from '../stores/viewport';
  import { recordProgress } from '../stores/reading-progress';
  import HighlightLayer from './HighlightLayer.svelte';
  import NoteLayer from './NoteLayer.svelte';
  import DrawLayer from './DrawLayer.svelte';
  import MermaidRenderer from './MermaidRenderer.svelte';
  import MarginaliaColumn from './MarginaliaColumn.svelte';
  import ReaderMeta from './ReaderMeta.svelte';
  import { readerMode } from '../stores/reader-mode';
  import { reattachTarget, cancelReattach } from '../stores/reattach';
  import { createAnchor, rangeTouchesDiagram, DIAGRAM_ANNOTATION_HINT } from '../lib/anchoring';
  import { addToast } from '../stores/toasts';
  import { get } from 'svelte/store';
  import type { Drawing } from '../lib/schema';
  import { editMode } from '../stores/edit-mode';
  import { pauseFileWatcher, resumeFileWatcher, loadIntoSession } from '../stores/doc';
  import Editor from './Editor.svelte';
  import { writeDocument } from '../lib/tauri-api';
  import { debounce } from '../lib/editor/debounce';
  import type { Debounced } from '../lib/editor/debounce';
  import { settings } from '../stores/settings';
  import { activeSession } from '../stores/sessions';
  import { onBeforeSwitch } from '../stores/tabs';
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';

  // No cross-fade under reduced motion, nor on the E-ink reader theme
  // (no animation at all there).
  function reducedMotion(): boolean {
    if (get(readerMode) && get(settings).readerTheme === 'eink') return true;
    return typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }

  let articleEl = $state<HTMLElement | null>(null);
  let scrollEl = $state<HTMLElement | null>(null);

  $effect(() => {
    if (articleEl) currentViewerRoot.set(articleEl);
    return () => currentViewerRoot.set(null);
  });

  $effect(() => {
    if (scrollEl) viewerScroll.set(scrollEl);
    return () => viewerScroll.set(null);
  });

  // Track reading progress on every scroll event while a doc is open.
  $effect(() => {
    const el = scrollEl;
    const currentDoc = $doc;
    if (!el || !currentDoc) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return; // no scrollable content yet
      const ratio = el.scrollTop / max;
      recordProgress(currentDoc.path, ratio);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  });

  // Re-attach mode: while $reattachTarget is set, the next non-empty
  // text selection inside the article commits a new anchor for that
  // annotation. This intentionally listens at the article level
  // regardless of the active tool — re-attach takes precedence over
  // the tool rail (which is also disabled via the body.reattach-mode
  // CSS).
  $effect(() => {
    const target = $reattachTarget;
    if (!target || !articleEl) return;
    const root = articleEl;

    const onMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (range.collapsed) return; // Empty selection — ignore (user can keep trying or press Esc).

      // Validate the range start + end are inside an article block.
      const startBlock = (range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement
      )?.closest('[data-block-id]') as HTMLElement | null;
      const endBlock = (range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement
      )?.closest('[data-block-id]') as HTMLElement | null;
      if (!startBlock || !endBlock) {
        addToast({
          kind: 'warning',
          message: 'Re-attach: select text inside the article. Press Esc to cancel.',
        });
        return;
      }

      // Same rule as creating a highlight/note: diagram text can't hold
      // a text anchor (see rangeTouchesDiagram).
      if (rangeTouchesDiagram(range)) {
        addToast({ kind: 'warning', message: `Re-attach: ${DIAGRAM_ANNOTATION_HINT}` });
        return;
      }

      const newAnchor = createAnchor(range, root);
      if (!newAnchor) {
        addToast({
          kind: 'warning',
          message: 'Re-attach: could not anchor to that selection. Try a different range.',
        });
        return;
      }

      // Find the annotation in the raw store and build the right patch
      // depending on its type.
      const all = get(annots);
      const a = all.find((x) => x.id === target.annotationId);
      if (!a) {
        cancelReattach();
        return;
      }

      const newBlockId = startBlock.getAttribute('data-block-id') ?? '';

      updateAnnotation(target.annotationId, (current) => {
        if (current.type === 'highlight' || current.type === 'note') {
          return { ...current, anchor: newAnchor };
        }
        // Drawings — anchor structure varies by shape kind.
        if (current.type === 'drawing') {
          const d = current as Drawing;
          const kind = d.shape.kind;
          if (kind === 'circle' || kind === 'rectangle' || kind === 'underline' || kind === 'strikethrough') {
            return { ...d, shape: { ...d.shape, anchor: newAnchor } };
          }
          if (kind === 'circle-empty') {
            return {
              ...d,
              shape: { ...d.shape, anchor: { ...d.shape.anchor, blockId: newBlockId } },
            };
          }
          if (kind === 'margin-bar' || kind === 'freehand') {
            return {
              ...d,
              shape: { ...d.shape, anchor: { blockId: newBlockId } as never },
            };
          }
          if (kind === 'freehand-legacy') {
            return { ...d, shape: { ...d.shape, anchorBlock: newBlockId } };
          }
        }
        return current;
      });

      sel.removeAllRanges();
      cancelReattach();
      addToast({ kind: 'info', message: 'Annotation re-attached.' });
    };

    root.addEventListener('mouseup', onMouseUp);
    return () => root.removeEventListener('mouseup', onMouseUp);
  });

  // Delegated click handler for foldable callout chevron buttons.
  $effect(() => {
    const root = articleEl;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement)?.closest?.('.callout-fold') as HTMLButtonElement | null;
      if (!btn) return;
      const callout = btn.closest('.callout');
      const body = callout?.querySelector<HTMLElement>('.callout-body');
      if (!body) return;
      const open = !body.hasAttribute('hidden');
      if (open) {
        body.setAttribute('hidden', '');
        btn.textContent = '▸';
        btn.setAttribute('aria-label', 'Expand');
      } else {
        body.removeAttribute('hidden');
        btn.textContent = '▾';
        btn.setAttribute('aria-label', 'Collapse');
      }
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  });

  let pendingSave: Debounced<[string]> | null = null;

  // CSS Custom Highlight API ranges live in a global registry; the
  // HighlightLayer component unmounts when entering edit mode but the
  // ranges it registered persist. Clear them so they don't paint stale
  // highlights over the editor surface.
  function clearPaintedHighlights() {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.clear();
    }
  }

  // Edit mode is per tab, so $editMode also changes when the user merely
  // switches between a tab that's editing and one that isn't. Only a change
  // within the SAME tab is the user entering / leaving edit mode — a switch
  // must not pause watchers or reload anything from disk.
  let lastSessionId: string | null = null;
  let lastEditMode = false;
  $effect(() => {
    const session = $activeSession;
    const on = $editMode;
    if (session.id !== lastSessionId) {
      lastSessionId = session.id;
      lastEditMode = on;
      if (on) clearPaintedHighlights();
      return;
    }
    if (on === lastEditMode) return;
    lastEditMode = on;
    if (on) {
      clearPaintedHighlights();
      void pauseFileWatcher(session);
    } else {
      // Flush any pending autosave so the file on disk reflects the
      // user's final edits, then reload the doc — re-renders article
      // HTML from the new markdown and runs the existing re-anchor
      // pipeline (annotations re-resolve, orphans go to the orphan
      // panel via the standard flow). The stashed editor state belongs
      // to the edit session that just ended.
      pendingSave?.flush();
      session.editorState = null;
      // Everything below names `session` explicitly: the reload is async and
      // the user may have switched tabs — or re-entered edit mode — by the
      // time it lands. Only resume watching if this tab isn't editing again.
      const currentDoc = get(session.doc);
      const reload = currentDoc ? loadIntoSession(session, currentDoc.path) : Promise.resolve(true);
      void reload.then(() => {
        if (!get(session.editMode)) void resumeFileWatcher(session);
      });
    }
  });

  // Before the active tab changes: write any pending edit-mode autosave to
  // the outgoing tab's file and remember exactly where it was scrolled.
  onDestroy(onBeforeSwitch((outgoing) => {
    pendingSave?.flush();
    if (scrollEl) outgoing.scrollTop = scrollEl.scrollTop;
  }));

  $effect(() => {
    const currentDoc = $doc;
    if (!currentDoc) {
      pendingSave?.cancel();
      pendingSave = null;
      return;
    }
    const ms = $settings.saveDebounceMs;
    pendingSave = debounce((markdown: string) => {
      void writeDocument(currentDoc.path, markdown);
    }, ms);
    return () => pendingSave?.flush();
  });

  function onEditorChange(markdown: string) {
    // Only the visible tab's editor receives input.
    get(activeSession).editedMarkdown = markdown;
    pendingSave?.(markdown);
  }
</script>

<div class="scroll" bind:this={scrollEl}>
  {#if $doc === null}
    <div class="empty">
      <p>Open a markdown file to start reading.</p>
    </div>
  {:else}
    <!-- Keyed on the tab so switching tabs cross-fades the page in. The
         incoming tab's content is already in memory, so this is a redraw,
         not a reload. -->
    {#key $activeSession.id}
    <div class="content" in:fade={{ duration: reducedMotion() ? 0 : 150 }}>
      <div class="text-frame">
        {#if $readerMode && !$editMode}
          <ReaderMeta />
        {/if}
        <!-- The article stays mounted in edit mode (hidden via
             body.edit-mode .viewer { display:none } in edit-mode.css) so
             the minimap, which subscribes to currentViewerRoot and
             mirrors the article's innerHTML, can keep rendering while
             the user edits. The doc store is frozen during edit (file
             watcher paused), so the minimap shows the last-saved view —
             acceptable per design. The companion layers DO unmount in
             edit mode: highlights/notes/marginalia don't anchor cleanly
             to a hidden article, and the editor doesn't need them. -->
        <article class="viewer md-rendered" bind:this={articleEl}>
          {@html $doc.html}
        </article>
        {#if !$editMode}
          <MermaidRenderer {articleEl} />
          <HighlightLayer />
          <NoteLayer />
          <!-- Marginalia hugs the text-frame's right edge (left:100% + 32px
               gap) so the cards live in the close margin instead of pinned
               to the screen edge. Inside text-frame because the cards'
               y-coords are computed in text-frame coordinate space. -->
          <MarginaliaColumn />
        {:else}
          <!-- Keyed on the tab too: two tabs can both be in edit mode, and
               each needs its own editor (restored from its saved state). -->
          {#key $activeSession.id + ($doc?.path ?? '')}
            <Editor
              initialMarkdown={$activeSession.editedMarkdown ?? $doc.markdown}
              onChange={onEditorChange}
              session={$activeSession}
            />
          {/key}
        {/if}
      </div>
      <!-- DrawLayer is a sibling of the text frame so the draw tool can paint
           across the full window width, not just within the text column. -->
      <DrawLayer />
    </div>
    {/key}
  {/if}
</div>

<style>
  .scroll {
    height: 100vh;
    width: 100vw;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    justify-content: center;
    /* Keep flex children at their intrinsic cross-axis (height) so .content grows
       with the text beneath. Without this, default align-items: stretch clamps
       .content to 100vh and the DrawLayer SVG inside ends up viewport-height
       only — meaning you can't draw on content below the first screen. */
    align-items: flex-start;
    /* Reserve space on the right for the minimap (140px wide + 16px gutter) plus
       a comfortable buffer, so centered content doesn't overlap with it on
       typical windows. This also shifts content left from absolute-center,
       reducing the empty margin on the left side. */
    padding-right: 172px;
    /* Navigation happens via the minimap (and wheel/keyboard); native scrollbar is noise. */
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .scroll::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
  .empty {
    margin-top: 40vh;
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 14px;
    text-align: center;
  }
  /* Full-width container so the draw tool can paint anywhere on the canvas. */
  .content {
    position: relative;
    width: 100%;
    min-height: 100vh;
  }
  /* Text column — centered on narrower windows, capped to a max left margin
     on wider ones so content doesn't drift away from the left edge as the
     window grows. The right side absorbs the remaining space (auto margin)
     and the .scroll's right padding reserves the minimap region.
     The width comes from --article-width, set by App.svelte from
     settings.articleWidth. Defaults to 720px before settings hydrate. */
  .text-frame {
    position: relative;
    max-width: var(--article-width, 720px);
    width: 100%;
    margin-left: clamp(0px, calc((100% - var(--article-width, 720px)) / 2), 140px);
    margin-right: auto;
  }
  /* Layout only. Content styling lives in src/styles/article.css via the
     `md-rendered` class so the minimap clone gets the same layout. */
  .viewer {
    width: 100%;
    padding: 96px 48px 160px;
  }
</style>
