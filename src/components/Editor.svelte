<!-- src/components/Editor.svelte -->
<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { EditorView } from 'prosemirror-view';
  import { toggleMark } from 'prosemirror-commands';
  import { createEditorView, insertCallout } from '../lib/editor/view';
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

  // Bubble-menu state — recomputed on every selection change.
  let bubble = $state({ visible: false, x: 0, y: 0, marks: new Set<string>() });

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
    bubble = { visible: true, x, y, marks };
  }

  function onToolbarInsert(action: string) {
    const v = view;
    if (!v) return;
    if (action === 'callout') {
      insertCallout('info')(v.state, v.dispatch);
      v.focus();
    }
  }

  function onBubbleMark(name: 'strong' | 'em' | 'code' | 'link') {
    const v = view;
    if (!v) return;
    const markType = editorSchema.marks[name];
    if (!markType) return;
    if (name === 'link') {
      const url = prompt('Enter URL:');
      if (!url) return;
      const tr = v.state.tr.addMark(v.state.selection.from, v.state.selection.to, markType.create({ href: url }));
      v.dispatch(tr);
    } else {
      toggleMark(markType)(v.state, v.dispatch);
    }
    v.focus();
    void tick().then(updateBubble);
  }

  // Click-outside handler — hide the bubble menu when the user clicks
  // anywhere outside the editor surface or the toolbar/bubble menu
  // themselves. PM keeps its selection state across focus changes, so
  // without this the bubble would stay visible forever after the user
  // clicks elsewhere in the app.
  function onDocumentMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!parentEl || !target) return;
    if (parentEl.contains(target)) return;
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
    document.addEventListener('selectionchange', updateBubble);
    document.addEventListener('mousedown', onDocumentMouseDown);
  });

  onDestroy(() => {
    if (parentEl) {
      parentEl.removeEventListener('mouseup', updateBubble);
      parentEl.removeEventListener('keyup', updateBubble);
    }
    document.removeEventListener('selectionchange', updateBubble);
    document.removeEventListener('mousedown', onDocumentMouseDown);
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
    activeMarks={bubble.marks}
  />
</div>

<style>
  .editor-shell {
    width: 100%;
    position: relative;
  }
  .editor-surface {
    width: 100%;
  }
  :global(.editor-surface .ProseMirror) {
    outline: none;
    min-height: 60vh;
    /* Match the read-mode article's column position. The read-mode
       `.viewer` rule (Viewer.svelte) uses `padding: 96px 48px 160px`.
       In edit mode the toolbar (~36px) sits above this surface and
       eats into the top — reduce padding-top by the toolbar's height
       so the first line of text lands at the same y as read mode.
       Left/right (48px) and bottom (160px) match exactly. */
    padding: 60px 48px 160px;
  }
</style>
