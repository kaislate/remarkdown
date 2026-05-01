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
    const fromCoords = v.coordsAtPos(sel.from);
    const toCoords = v.coordsAtPos(sel.to);
    const x = (fromCoords.left + toCoords.right) / 2;
    const y = Math.min(fromCoords.top, toCoords.top);
    const marks = new Set<string>();
    const selFrom = sel.$from;
    const stored = v.state.storedMarks ?? selFrom.marks();
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

  onMount(() => {
    if (!parentEl) return;
    view = createEditorView(parentEl, initialMarkdown, (md) => {
      onChange(md);
      updateBubble();
    });
    parentEl.addEventListener('mouseup', updateBubble);
    parentEl.addEventListener('keyup', updateBubble);
    document.addEventListener('selectionchange', updateBubble);
  });

  onDestroy(() => {
    if (parentEl) {
      parentEl.removeEventListener('mouseup', updateBubble);
      parentEl.removeEventListener('keyup', updateBubble);
    }
    document.removeEventListener('selectionchange', updateBubble);
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
  }
</style>
