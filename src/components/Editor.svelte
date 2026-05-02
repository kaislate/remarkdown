<!-- src/components/Editor.svelte -->
<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { EditorView } from 'prosemirror-view';
  import { toggleMark } from 'prosemirror-commands';
  import { createEditorView, insertCallout, insertCodeBlock } from '../lib/editor/view';
  import { editorSchema } from '../lib/editor/schema';
  import EditorToolbar from './EditorToolbar.svelte';
  import EditorBubbleMenu from './EditorBubbleMenu.svelte';

  interface Props {
    initialMarkdown: string;
    onChange: (markdown: string) => void;
  }
  let { initialMarkdown, onChange }: Props = $props();

  let parentEl = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;

  // Bubble-menu state — recomputed on every selection change. linkHref
  // is the href of any link mark active across the whole selection;
  // empty string when there's no link or the link only covers part of
  // the range. Pre-fills the link popover when the user opens it.
  let bubble = $state({
    visible: false,
    x: 0,
    y: 0,
    marks: new Set<string>(),
    linkHref: '',
  });

  function updateBubble() {
    const v = view;
    if (!v) return;
    const sel = v.state.selection;
    if (sel.empty) {
      bubble = { ...bubble, visible: false };
      return;
    }
    // PM's coordsAtPos returns viewport-relative coordinates. The bubble
    // menu is absolutely positioned inside .editor-shell (position:relative),
    // so we have to subtract the shell's bounding rect to get the right
    // coordinates relative to its containing block.
    const shellEl = parentEl?.closest<HTMLElement>('.editor-shell');
    const shellRect = shellEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const fromCoords = v.coordsAtPos(sel.from);
    const toCoords = v.coordsAtPos(sel.to);
    const x = (fromCoords.left + toCoords.right) / 2 - shellRect.left;
    const y = Math.min(fromCoords.top, toCoords.top) - shellRect.top;
    // Active marks: prefer marksAcross (which returns marks active over
    // the FULL selection range, not just at the start). storedMarks
    // takes precedence for cursor-position-toggle cases.
    const marks = new Set<string>();
    const stored = v.state.storedMarks ?? sel.$from.marksAcross(sel.$to) ?? [];
    for (const m of stored) marks.add(m.type.name);
    const linkMark = stored.find((m) => m.type.name === 'link');
    const linkHref = linkMark ? String(linkMark.attrs.href ?? '') : '';
    bubble = { visible: true, x, y, marks, linkHref };
  }

  function onToolbarInsert(action: string) {
    const v = view;
    if (!v) return;
    if (action === 'callout') {
      insertCallout('info')(v.state, v.dispatch);
      v.focus();
    } else if (action === 'code') {
      insertCodeBlock('')(v.state, v.dispatch);
      v.focus();
    }
  }

  function onBubbleMark(name: 'strong' | 'em' | 'code') {
    const v = view;
    if (!v) return;
    const markType = editorSchema.marks[name];
    if (!markType) return;
    toggleMark(markType)(v.state, v.dispatch);
    v.focus();
    void tick().then(updateBubble);
  }

  // Apply (or clear) the link mark from the popover. Empty url means
  // "remove any link mark in the selection". We always remove first so
  // a single Apply also overwrites an existing href instead of layering
  // a second mark on top.
  function onApplyLink(url: string) {
    const v = view;
    if (!v) return;
    const linkType = editorSchema.marks.link;
    if (!linkType) return;
    const sel = v.state.selection;
    if (sel.empty) return;
    let tr = v.state.tr.removeMark(sel.from, sel.to, linkType);
    if (url) {
      tr = tr.addMark(sel.from, sel.to, linkType.create({ href: url }));
    }
    v.dispatch(tr);
    v.focus();
    void tick().then(updateBubble);
  }

  // Hide the bubble on ANY mousedown that isn't on the toolbar or
  // bubble menu itself. mouseup will re-show it if the selection is
  // still non-empty (i.e., the user finished a new drag-select). This
  // handles three cases that the previous "click outside parentEl"
  // check missed:
  //   - Click inside the editor on a different point (PM may keep
  //     its selection if the click lands inside the existing range
  //     or hits a non-text element).
  //   - Click on chrome / blank canvas / minimap area.
  //   - Click during a text selection that PM doesn't fully collapse.
  // We allow the toolbar and bubble menu through so their buttons
  // can fire (combined with onmousedown preventDefault on each
  // button so the editor's selection survives the click).
  function onAnyMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.editor-toolbar')) return;
    if (target.closest('.editor-bubble-menu')) return;
    bubble = { ...bubble, visible: false };
  }

  onMount(() => {
    if (!parentEl) return;
    view = createEditorView(parentEl, initialMarkdown, (md) => {
      onChange(md);
      updateBubble();
    });
    parentEl.addEventListener('mouseup', updateBubble);
    parentEl.addEventListener('keyup', updateBubble);
    document.addEventListener('mousedown', onAnyMouseDown);
    // NOTE: previously had a `selectionchange` listener too, but it
    // races onAnyMouseDown — every click outside the editor changes
    // the document selection, fires selectionchange, which calls
    // updateBubble, which reads PM's still-non-empty state and
    // re-shows the bubble we just hid. mouseup + keyup on parentEl
    // catch the cases that matter (drag-select, shift+arrow), and
    // onAnyMouseDown handles dismissal.
  });

  onDestroy(() => {
    if (parentEl) {
      parentEl.removeEventListener('mouseup', updateBubble);
      parentEl.removeEventListener('keyup', updateBubble);
    }
    document.removeEventListener('mousedown', onAnyMouseDown);
    view?.destroy();
    view = null;
  });
</script>

<div class="editor-shell">
  <EditorToolbar onInsert={onToolbarInsert} />
  <div class="editor-surface" bind:this={parentEl}></div>
  <EditorBubbleMenu
    visible={bubble.visible}
    x={bubble.x}
    y={bubble.y}
    onMark={onBubbleMark}
    onApplyLink={onApplyLink}
    activeMarks={bubble.marks}
    linkHref={bubble.linkHref}
  />
</div>

<style>
  .editor-shell {
    width: 100%;
    position: relative;
  }
  .editor-surface {
    width: 100%;
    /* Match the read-mode `.viewer` structure exactly: padding lives on
       the OUTER container, not on the contenteditable inside. The
       read-mode rule is `padding: 96px 48px 160px` on the article;
       here we shave 36px off the top to compensate for the toolbar
       sitting above. Left/right (48px) and bottom (160px) match the
       reader so a paragraph wraps at the same column in both modes.
       (Previously the padding lived on the inner `.ProseMirror`, which
       interacted oddly with PM's auto-width tracking and produced a
       visibly narrower column in edit mode.) */
    padding: 60px 48px 160px;
    box-sizing: content-box;
  }
  :global(.editor-surface .ProseMirror) {
    outline: none;
    min-height: 60vh;
  }
</style>
