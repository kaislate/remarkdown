<script lang="ts">
  // The app's right-click menu for everything that doesn't have one of its
  // own (lib/app-context-menu.ts decides what's in it). Runs last — the
  // menus for a highlight, a drawing, a tab or a recent file get the click
  // first and claim it — and always stops the browser's own menu.
  import { get } from 'svelte/store';
  import ContextMenu, { type ContextMenuEntry } from './ContextMenu.svelte';
  import { classify, menuFor, selectionToKeep, type MenuActions } from '../lib/app-context-menu';
  import { readerMode, exitReaderMode, toggleReaderMode } from '../stores/reader-mode';
  import { toggleEditMode } from '../stores/edit-mode';
  import { doc } from '../stores/doc';
  import { currentViewerRoot } from '../stores/annots';
  import { highlightSelection } from '../lib/highlight-selection';
  import { addNoteForSelection } from '../lib/note-actions';
  import { showInFolder, copyPath } from '../lib/file-actions';
  import { jumpToSection } from '../lib/section-jump';
  import { addToast } from '../stores/toasts';
  import { undoAnnot, redoAnnot, canUndoAnnot, canRedoAnnot } from '../stores/annots';
  import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

  let menu = $state<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);

  // What the menu acts on: the field or editor clicked, and the selection
  // as it was (opening the menu takes focus away).
  let target: HTMLElement | null = null;
  let fieldSelection: [number, number] | null = null;
  let savedRange: Range | null = null;

  type Field = HTMLInputElement | HTMLTextAreaElement;
  const isField = (el: Element | null): el is Field => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

  function fieldRange(el: Field): [number, number] | null {
    try {
      return el.selectionStart === null || el.selectionEnd === null ? null : [el.selectionStart, el.selectionEnd];
    } catch {
      return null; // inputs without a text selection (number…)
    }
  }

  // Back to where things were before the menu opened.
  function restore(): void {
    if (isField(target)) {
      target.focus();
      if (fieldSelection) target.setSelectionRange(fieldSelection[0], fieldSelection[1]);
      return;
    }
    target?.focus?.();
    if (savedRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange);
    }
  }

  async function copyText(text: string): Promise<void> {
    try {
      await writeText(text);
    } catch {
      await navigator.clipboard.writeText(text).catch(() => addToast({ kind: 'error', message: "Couldn't copy." }));
    }
  }

  const actions: MenuActions = {
    cut: () => { restore(); document.execCommand('cut'); },
    copy: () => {
      restore();
      // Fields and the editor copy their own way (the editor keeps its
      // formatting); the page copies the selected text.
      if (isField(target) || target?.isContentEditable) document.execCommand('copy');
      else void copyText(window.getSelection()?.toString() ?? '');
    },
    paste: async () => {
      let text = '';
      try {
        text = await readText();
      } catch {
        text = await navigator.clipboard.readText().catch(() => '');
      }
      restore();
      if (text) document.execCommand('insertText', false, text);
    },
    selectAll: () => {
      if (isField(target)) { target.focus(); target.select(); return; }
      if (target?.isContentEditable) { target.focus(); document.execCommand('selectAll'); return; }
      const article = get(currentViewerRoot);
      if (!article) return;
      const range = document.createRange();
      range.selectNodeContents(article);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    },
    highlight: () => { restore(); highlightSelection(); },
    addNote: () => { restore(); addNoteForSelection(); },
    copyLink: (href) => { void copyText(href).then(() => addToast({ kind: 'info', message: 'Link address copied.' })); },
    goToSection: (href) => {
      const id = decodeURIComponent(href.slice(1));
      const el = get(currentViewerRoot)?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (el) jumpToSection(el);
    },
    toggleEdit: () => toggleEditMode(),
    enterReader: () => toggleReaderMode(),
    leaveReader: () => exitReaderMode(),
    showInFolder: (path) => void showInFolder(path),
    copyPath: (path) => void copyPath(path),
    undo: () => {
      const what = undoAnnot();
      if (what) addToast({ kind: 'info', message: `Undone: ${what}.` });
    },
    redo: () => {
      const what = redoAnnot();
      if (what) addToast({ kind: 'info', message: `Redone: ${what}.` });
    },
  };

  function onContextMenu(e: MouseEvent): void {
    // Another menu (a highlight's, a tab's…) has it.
    if (e.defaultPrevented) return;
    // Never the browser's own menu.
    e.preventDefault();
    const { kind, el, href } = classify(e.target as Element | null);
    target = el instanceof HTMLElement ? el : null;
    fieldSelection = null;
    savedRange = null;

    let hasSelection = false;
    let readOnly = false;
    if (isField(el)) {
      fieldSelection = fieldRange(el);
      hasSelection = !!fieldSelection && fieldSelection[0] !== fieldSelection[1];
      readOnly = el.readOnly || el.disabled;
    } else {
      const within = kind === 'editor' ? el : get(currentViewerRoot);
      savedRange = selectionToKeep(kind, window.getSelection(), within);
      hasSelection = !!savedRange && !savedRange.collapsed;
    }

    const items = menuFor(
      { kind, readerMode: get(readerMode), hasSelection, readOnly, href, path: get(doc)?.path, canUndo: canUndoAnnot(), canRedo: canRedoAnnot() },
      actions,
    );
    menu = items ? { x: e.clientX, y: e.clientY, items } : null;
  }
</script>

<svelte:window oncontextmenu={onContextMenu} />

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} label="Options" items={menu.items} onclose={() => (menu = null)} />
{/if}
