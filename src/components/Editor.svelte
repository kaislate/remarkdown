<!-- src/components/Editor.svelte -->
<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { EditorView } from 'prosemirror-view';
  import { toggleMark } from 'prosemirror-commands';
  import { TextSelection } from 'prosemirror-state';
  import { createEditorView, insertCallout, insertCodeBlock, insertTaskList, insertTable, insertMermaid, insertSequenceDiagram } from '../lib/editor/view';
  import { editorSchema } from '../lib/editor/schema';
  import EditorToolbar from './EditorToolbar.svelte';
  import EditorBubbleMenu from './EditorBubbleMenu.svelte';
  import TableActionsMenu from './TableActionsMenu.svelte';
  import { tableActionsKey } from '../lib/editor/table-actions-plugin';
  import {
    addRowAfterCmd,
    addColumnAfterCmd,
    deleteRowCmd,
    deleteColumnCmd,
  } from '../lib/editor/table-commands';

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

  // Table actions menu state — recomputed on selection / doc change
  // alongside `bubble`. Visible when the cursor is inside any table
  // (the table-actions plugin tracks the active table's pos). The
  // menu floats above the active table's top edge.
  let tableMenu = $state({ visible: false, x: 0, y: 0 });

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

  function updateTableMenu() {
    const v = view;
    if (!v) {
      tableMenu = { ...tableMenu, visible: false };
      return;
    }
    const ps = tableActionsKey.getState(v.state);
    if (!ps?.active) {
      tableMenu = { ...tableMenu, visible: false };
      return;
    }
    const tableNode = v.state.doc.nodeAt(ps.active.tablePos);
    if (!tableNode) {
      tableMenu = { ...tableMenu, visible: false };
      return;
    }
    // Coordinates just inside the table's open token. coordsAtPos is
    // viewport-relative; subtract the editor-shell rect (the bubble's
    // containing block — see updateBubble) to get shell-local coords.
    const coords = v.coordsAtPos(ps.active.tablePos + 1);
    const shellEl = parentEl?.closest<HTMLElement>('.editor-shell');
    const shellRect = shellEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
    // Approximate horizontal centering — true centering needs the
    // table's actual width. 100px right of the left edge is a
    // reasonable v1 anchor; refined in Task 10 if needed.
    const x = coords.left - shellRect.left + 100;
    const y = coords.top - shellRect.top;
    tableMenu = { visible: true, x, y };
  }

  function runTableCmd(cmd: typeof addRowAfterCmd) {
    const v = view;
    if (!v) return;
    cmd(v.state, v.dispatch);
    v.focus();
    // Re-evaluate menu position after the command runs — row/column
    // mutations change the table's bounding rect.
    void tick().then(updateTableMenu);
  }

  // Belt-and-braces: if PM's selection somehow landed inside a code_block
  // (e.g. the user clicked into the mermaid wrapper before the
  // contentEditable=false fix took effect, or a future regression
  // re-introduces the issue), move it to a safe paragraph position OUTSIDE
  // any code_block. Without this, three of the toolbar inserts
  // (insertCodeBlock, insertTaskList, insertMermaid) refuse to run, and the
  // other two (insertCallout, insertTable) silently wrap the code_block in
  // a callout/table wrapper instead of inserting at top-level — both
  // surprising and undesirable. The fix moves the cursor to the end of the
  // first non-code_block text position so the user gets a predictable
  // insert point regardless of where they clicked.
  function ensureSelectionOutsideCodeBlock(v: EditorView) {
    // Svelte 5 reserves identifiers starting with `$` (rune syntax), so we
    // can't bind PM's `$from` directly — read it as a normal field instead.
    const fromPos = v.state.selection.$from;
    if (fromPos.parent.type.name !== 'code_block') return;
    // Walk descendants for the first non-code text-block position; fall back
    // to position 1 (start of doc) if the doc is somehow all code blocks.
    let safePos = -1;
    v.state.doc.descendants((node, pos) => {
      if (safePos !== -1) return false;
      if (node.isTextblock && node.type.name !== 'code_block') {
        safePos = pos + 1;
        return false;
      }
      return true;
    });
    if (safePos === -1) safePos = 1;
    const tr = v.state.tr.setSelection(
      TextSelection.near(v.state.doc.resolve(safePos)),
    );
    v.dispatch(tr);
  }

  function onToolbarInsert(action: string) {
    const v = view;
    if (!v) return;
    // Focus first so the editor is the active element when the command
    // runs — some browsers won't apply selection updates to an unfocused
    // contentEditable, which would leave dispatchTransaction running
    // against a stale selection.
    v.focus();
    ensureSelectionOutsideCodeBlock(v);
    if (action === 'callout') {
      insertCallout('info')(v.state, v.dispatch);
    } else if (action === 'code') {
      insertCodeBlock('')(v.state, v.dispatch);
    } else if (action === 'tasks') {
      insertTaskList()(v.state, v.dispatch);
    } else if (action === 'table') {
      insertTable(3, 2)(v.state, v.dispatch);
    } else if (action === 'mermaid') {
      insertMermaid()(v.state, v.dispatch);
    } else if (action === 'sequence') {
      insertSequenceDiagram()(v.state, v.dispatch);
    }
    v.focus();
  }

  function onBubbleMark(name: 'strong' | 'em' | 'strike' | 'code') {
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
    // Allow clicks inside the table-actions menu to fall through to
    // its button handlers without dismissing the bubble — the table
    // menu is its own visibility lifecycle (driven by selection-in-
    // table state) so we don't need to hide it here.
    if (target.closest('.table-actions-menu')) return;
    bubble = { ...bubble, visible: false };
  }

  // Wrappers fire BOTH bubble + table-menu updates on every event —
  // selections and doc changes can affect either. Cheap to run both
  // since each early-returns when its precondition isn't met.
  function onSelectionMaybeChanged() {
    updateBubble();
    updateTableMenu();
  }

  onMount(() => {
    if (!parentEl) return;
    view = createEditorView(parentEl, initialMarkdown, (md) => {
      onChange(md);
      updateBubble();
      updateTableMenu();
    });
    parentEl.addEventListener('mouseup', onSelectionMaybeChanged);
    parentEl.addEventListener('keyup', onSelectionMaybeChanged);
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
      parentEl.removeEventListener('mouseup', onSelectionMaybeChanged);
      parentEl.removeEventListener('keyup', onSelectionMaybeChanged);
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
  <TableActionsMenu
    visible={tableMenu.visible}
    x={tableMenu.x}
    y={tableMenu.y}
    onAddRow={() => runTableCmd(addRowAfterCmd)}
    onAddCol={() => runTableCmd(addColumnAfterCmd)}
    onDelRow={() => runTableCmd(deleteRowCmd)}
    onDelCol={() => runTableCmd(deleteColumnCmd)}
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
