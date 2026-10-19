// Mindmap editing (see controller.ts for the contract), outline-style
// like an outliner in a word processor: click an idea to open its
// popover — its text (bold / italic: mermaid draws every mindmap label
// as markdown), its shape, and add child / add sibling / indent /
// outdent / move / delete. Tab and Shift+Tab indent / outdent while
// the popover is open. Edits go through mindmap-edit.ts, which only
// rewrites the lines an edit is about (icons and classes travel with
// their idea and are never shown).
import MermaidFormPopover from '../../../components/MermaidFormPopover.svelte';
import MermaidActionsBar from '../../../components/MermaidActionsBar.svelte';
import { parseMindmap, type MindmapModel, type MindmapNode, type MindmapShape } from './mindmap-parser';
import { applyMindmapEdit, type MindmapEdit, type MindmapEditResult } from './mindmap-edit';
import { mindmapElementFor, mindmapTargetAt } from './mindmap-svg';
import { parseRich, hasFormatting, richToPlain } from './rich-text';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';
import { HIDDEN_BAR, HIDDEN_FORM, type ActionsBarState, type ChoiceOption, type FormAction, type FormPopoverState } from './form';

// Ideas are addressed by their position in source order (MindmapNode.
// index) — what the edit engine keys on, and mermaid's own numbering.
type Selection = { index: number } | null;

const SHAPES: ChoiceOption[] = [
  { value: 'default', label: 'Plain', icon: 'text' },
  { value: 'square', label: 'Square', icon: 'square' },
  { value: 'rounded', label: 'Rounded', icon: 'pill' },
  { value: 'circle', label: 'Circle', icon: 'circle' },
  { value: 'bang', label: 'Burst', icon: 'lightning' },
  { value: 'cloud', label: 'Cloud', icon: 'cloud' },
  { value: 'hexagon', label: 'Hexagon', icon: 'hexagon' },
];

// The node view's wrapper sits inside ProseMirror's contenteditable, so
// a UI host inherits editability: a rich-text field in it is then NOT
// its own editing host — clicking it leaves the focus (and Ctrl+A,
// and typing) in the document. Hosts made non-editable give the field
// its own editing context.
export function ownEditingHost(host: DiagramHost): DiagramHost {
  return {
    get dom() {
      return host.dom;
    },
    get renderedEl() {
      return host.renderedEl;
    },
    source: () => host.source(),
    commit: (source) => host.commit(source),
    createUiHost: (className) => {
      const el = host.createUiHost(className);
      el.contentEditable = 'false';
      return el;
    },
    anchor: (el, placement) => host.anchor(el, placement),
    setEscapeHandler: (handler) => host.setEscapeHandler(handler),
  };
}

export class MindmapController implements DiagramController {
  private host: DiagramHost;
  // Latest successfully-parsed mindmap; null in fallback mode.
  private model: MindmapModel | null = null;
  private selected: Selection = null;
  // See FlowchartController.pendingSelect: the idea an add / move just
  // produced, selected once its SVG exists.
  private pendingSelect: number | null = null;
  private form: MountedUi<FormPopoverState>;
  private actions: MountedUi<ActionsBarState>;

  constructor(host: DiagramHost) {
    this.host = host;
    const ui = ownEditingHost(host);
    this.form = mountUi(ui, MermaidFormPopover, 'mermaid-popover-host mermaid-form-popover-host', HIDDEN_FORM);
    this.actions = mountUi(ui, MermaidActionsBar, 'mermaid-popover-host mermaid-actions-host', HIDDEN_BAR);
    host.dom.addEventListener('keydown', this.onKey);
  }

  load(source: string): boolean {
    const parsed = parseMindmap(source);
    this.model = parsed.ok ? parsed.model : null;
    return parsed.ok;
  }

  // A fresh `mindmap` with no ideas yet: offer the central one.
  emptyState(): EmptyState | null {
    if (!this.model || this.model.nodes.length > 0) return null;
    return {
      label: '+ Add the central idea',
      onActivate: () =>
        this.commit({ kind: 'addRoot', text: '' }, (r) => {
          if (r.index !== undefined) this.pendingSelect = r.index;
        }),
    };
  }

  rendered(): void {
    const pending = this.pendingSelect;
    this.pendingSelect = null;
    if (pending !== null && this.node(pending)) {
      this.select(pending);
    } else if (this.selected) {
      if (this.node(this.selected.index)) this.select(this.selected.index);
      else this.clearSelection();
    }
    this.refreshActions();
  }

  cleared(): void {
    this.pendingSelect = null;
    this.clearSelection();
    this.actions.hide();
  }

  click(target: Element): boolean {
    const svg = target.closest('svg');
    const hit = svg && this.model ? mindmapTargetAt(target, svg, this.model) : null;
    if (hit) {
      this.select(hit.index);
      return true;
    }
    this.clearSelection();
    return false;
  }

  destroy(): void {
    this.host.dom.removeEventListener('keydown', this.onKey);
    this.form.destroy();
    this.actions.destroy();
  }

  // ── selection ──────────────────────────────────────────────────────

  private node(index: number): MindmapNode | undefined {
    return this.model?.nodes[index];
  }

  private element(index: number): Element | null {
    const svg = this.host.renderedEl.querySelector('svg');
    return svg && this.model ? mindmapElementFor(svg, this.model, { kind: 'node', index }) : null;
  }

  private select(index: number): void {
    this.selected = { index };
    this.host.dom.classList.add('mermaid-has-selection');
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    const el = this.element(index);
    el?.classList.add('mermaid-selected');
    this.openPopover(index, el);
  }

  private clearSelection(): void {
    this.dropSelection();
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
  }

  // Deletes make the selection stale — drop it BEFORE committing so the
  // re-render doesn't select whatever moves into that place.
  private dropSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.form.hide();
  }

  // ── popover ────────────────────────────────────────────────────────

  private openPopover(index: number, el: Element | null): void {
    const model = this.model;
    const node = this.node(index);
    if (!model || !node) return;
    const { x, y } = this.host.anchor(el, 'right');
    const siblings = node.parent === null ? [index] : model.nodes[node.parent].children;
    const at = siblings.indexOf(index);
    const isRoot = node.parent === null;
    const actions: FormAction[] = [
      { id: 'add-child', label: 'Add child', icon: 'plus', onClick: () => this.add({ kind: 'addChild', index, text: '' }) },
    ];
    if (!isRoot) {
      actions.push({ id: 'add-sibling', label: 'Add sibling', icon: 'plus', onClick: () => this.add({ kind: 'addSibling', index, text: '' }) });
    }
    if (at > 0) actions.push({ id: 'indent', label: 'Indent', icon: 'indent', onClick: () => this.move({ kind: 'indent', index }) });
    if (!isRoot && model.nodes[node.parent!].parent !== null) {
      actions.push({ id: 'outdent', label: 'Outdent', icon: 'outdent', onClick: () => this.move({ kind: 'outdent', index }) });
    }
    if (at > 0) actions.push({ id: 'move-up', label: 'Move up', icon: 'up', onClick: () => this.move({ kind: 'moveUp', index }) });
    if (at < siblings.length - 1) {
      actions.push({ id: 'move-down', label: 'Move down', icon: 'down', onClick: () => this.move({ kind: 'moveDown', index }) });
    }
    if (!isRoot) {
      actions.push({
        id: 'delete',
        label: node.children.length ? 'Delete (with its branch)' : 'Delete',
        icon: 'trash',
        danger: true,
        onClick: () => {
          this.dropSelection();
          this.commit({ kind: 'delete', index });
        },
      });
    }
    this.form.show({
      visible: true,
      x,
      y,
      key: `node:${index}`,
      title: isRoot ? 'Central idea' : 'Idea',
      fields: [
        {
          kind: 'rich',
          id: 'text',
          label: 'Text',
          // A blank idea (written as one space) shows the placeholder.
          value: node.richText.trim() === '' ? '' : node.richText,
          placeholder: 'Type the idea',
          className: 'mermaid-mindmap-text',
          onCommit: (md) => {
            const runs = parseRich(md);
            const markdown = hasFormatting(runs);
            this.commit({ kind: 'rename', index, text: markdown ? md : richToPlain(runs), markdown });
          },
        },
        {
          kind: 'choice',
          id: 'shape',
          label: 'Shape',
          value: node.shape,
          options: SHAPES,
          onChange: (shape) => this.commit({ kind: 'setShape', index, shape: shape as MindmapShape }),
        },
        { kind: 'hint', id: 'keys', text: 'Tab indents, Shift+Tab outdents.' },
      ],
      actions,
      onClose: () => this.form.hide(),
    });
  }

  private refreshActions(): void {
    const model = this.model;
    if (!model || model.nodes.length === 0) {
      this.actions.hide();
      return;
    }
    this.actions.show({
      visible: true,
      ariaLabel: 'Mindmap actions',
      items: [{ id: 'add-idea', label: 'Idea', icon: 'plus', onClick: () => this.add({ kind: 'addChild', index: 0, text: '' }) }],
    });
  }

  // Tab / Shift+Tab in the open popover: indent / outdent the idea. A
  // half-typed text is committed first (blur commits the field).
  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !this.selected) return;
    const target = e.target as Element | null;
    if (!target?.closest('.mermaid-form-popover')) return;
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    const index = this.selected.index;
    this.move({ kind: e.shiftKey ? 'outdent' : 'indent', index });
  };

  // ── edits ──────────────────────────────────────────────────────────

  // `beforeCommit` runs with the edit's result before the transaction is
  // dispatched (see FlowchartController.commit).
  private commit(edit: MindmapEdit, beforeCommit?: (result: MindmapEditResult) => void): boolean {
    if (!this.model) return false;
    const source = this.host.source();
    if (source == null) return false;
    const result = applyMindmapEdit(source, edit);
    if (!result) return false;
    beforeCommit?.(result);
    this.host.commit(result.source);
    return true;
  }

  // A new, empty idea whose popover opens once it's drawn.
  private add(edit: MindmapEdit): void {
    this.commit(edit, (r) => {
      if (r.index !== undefined) this.pendingSelect = r.index;
    });
  }

  // Indent / outdent / move: the idea stays selected wherever it lands.
  private move(edit: MindmapEdit): void {
    this.commit(edit, (r) => {
      if (r.index !== undefined) {
        this.selected = { index: r.index };
        this.pendingSelect = r.index;
      }
    });
  }
}
