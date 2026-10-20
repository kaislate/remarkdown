// The app's own right-click menu (AppContextMenu.svelte). The browser's
// menu never shows; what the app offers depends on where the click was:
//
//   reader mode    copy (with a selection), leave reader mode
//   text field     cut / copy / paste / select all
//   the editor     cut / copy / paste / select all, done editing
//   a link         copy link address (go to section, for links inside)
//   selected text  copy, highlight, add a re.mark, select all
//   the page       undo / redo (annotations), edit, reader mode, show in
//                  folder, copy path, select all
//   anything else  (buttons, panels) nothing
//
// Menus that belong to a particular thing — a highlight, a drawing, a tab,
// a recent file — still come first; this is everything else.
import type { ContextMenuEntry } from '../components/ContextMenu.svelte';

export type ClickKind = 'field' | 'editor' | 'link' | 'page' | 'chrome';

export interface ClickContext {
  kind: ClickKind;
  readerMode: boolean;
  // Text selected where the click was (in the field, editor or page).
  hasSelection: boolean;
  // A field that can't be typed into.
  readOnly?: boolean;
  href?: string;
  // The open document's file, if any.
  path?: string;
  // Annotation changes that can be undone / redone.
  canUndo?: boolean;
  canRedo?: boolean;
}

export interface MenuActions {
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
  highlight: () => void;
  addNote: () => void;
  copyLink: (href: string) => void;
  goToSection: (href: string) => void;
  toggleEdit: () => void;
  enterReader: () => void;
  leaveReader: () => void;
  showInFolder: (path: string) => void;
  copyPath: (path: string) => void;
  undo: () => void;
  redo: () => void;
}

// What a click on `target` is about.
export function classify(target: Element | null, opts: { articleSelector?: string; pageSelector?: string } = {}): { kind: ClickKind; el: Element | null; href?: string } {
  const article = opts.articleSelector ?? '.viewer';
  const pageSel = opts.pageSelector ?? '.scroll';
  if (!target) return { kind: 'chrome', el: null };
  const field = target.closest('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="number"]');
  if (field) return { kind: 'field', el: field };
  const editor = target.closest('[contenteditable="true"], [contenteditable=""]');
  if (editor) return { kind: 'editor', el: editor };
  // Controls inside the page (diagram buttons, a note pin) are chrome.
  if (target.closest('button, [role="button"], [role="menu"], [role="dialog"], .note-pin')) return { kind: 'chrome', el: null };
  const link = target.closest(`${article} a[href]`);
  if (link) return { kind: 'link', el: link, href: link.getAttribute('href') ?? '' };
  const page = target.closest(pageSel);
  if (page) return { kind: 'page', el: page };
  return { kind: 'chrome', el: null };
}

const sep = 'separator' as const;

// The menu for a click, or null for none.
export function menuFor(ctx: ClickContext, a: MenuActions): ContextMenuEntry[] | null {
  const textEditing = (editable: boolean): ContextMenuEntry[] => [
    { label: 'Cut', hint: 'Ctrl+X', disabled: !editable || !ctx.hasSelection, onSelect: a.cut },
    { label: 'Copy', hint: 'Ctrl+C', disabled: !ctx.hasSelection, onSelect: a.copy },
    { label: 'Paste', hint: 'Ctrl+V', disabled: !editable, onSelect: a.paste },
    sep,
    { label: 'Select all', hint: 'Ctrl+A', onSelect: a.selectAll },
  ];

  if (ctx.kind === 'field') return textEditing(!ctx.readOnly);
  if (ctx.kind === 'chrome') return null;

  if (ctx.readerMode) {
    const items: ContextMenuEntry[] = [];
    if (ctx.hasSelection) items.push({ label: 'Copy', hint: 'Ctrl+C', onSelect: a.copy }, sep);
    items.push({ label: 'Leave reader mode', hint: 'Esc', onSelect: a.leaveReader });
    return items;
  }

  if (ctx.kind === 'editor') {
    return [...textEditing(true), sep, { label: 'Done editing', hint: 'Ctrl+E', onSelect: a.toggleEdit }];
  }

  if (ctx.kind === 'link' && ctx.href) {
    const href = ctx.href;
    const items: ContextMenuEntry[] = href.startsWith('#')
      ? [{ label: 'Go to section', onSelect: () => a.goToSection(href) }]
      : [{ label: 'Copy link address', onSelect: () => a.copyLink(href) }];
    if (ctx.hasSelection) items.push(sep, { label: 'Copy', hint: 'Ctrl+C', onSelect: a.copy });
    return items;
  }

  // The page.
  if (ctx.hasSelection) {
    return [
      { label: 'Copy', hint: 'Ctrl+C', onSelect: a.copy },
      sep,
      { label: 'Highlight', onSelect: a.highlight },
      { label: 'Add a re.mark', onSelect: a.addNote },
      sep,
      { label: 'Select all', hint: 'Ctrl+A', onSelect: a.selectAll },
    ];
  }
  const items: ContextMenuEntry[] = [];
  if (ctx.canUndo) items.push({ label: 'Undo', hint: 'Ctrl+Z', onSelect: a.undo });
  if (ctx.canRedo) items.push({ label: 'Redo', hint: 'Ctrl+Y', onSelect: a.redo });
  if (items.length) items.push(sep);
  items.push(
    { label: 'Edit', hint: 'Ctrl+E', onSelect: a.toggleEdit },
    { label: 'Reader mode', onSelect: a.enterReader },
  );
  if (ctx.path) {
    const path = ctx.path;
    items.push(sep, { label: 'Show in folder', onSelect: () => a.showInFolder(path) }, { label: 'Copy file path', onSelect: () => a.copyPath(path) });
  }
  items.push(sep, { label: 'Select all', hint: 'Ctrl+A', onSelect: a.selectAll });
  return items;
}
