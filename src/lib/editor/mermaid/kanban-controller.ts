// Kanban editing (see controller.ts for the contract). Click a column
// header to rename it, add a card, move it left / right or delete it;
// click a card to edit its text, who it's assigned to, its ticket and
// priority, move it to another column or up / down, or delete it. The
// floating bar adds columns. Edits go through kanban-edit.ts, which only
// rewrites the lines an edit is about.
import MermaidFormPopover from '../../../components/MermaidFormPopover.svelte';
import MermaidActionsBar from '../../../components/MermaidActionsBar.svelte';
import { KANBAN_PRIORITIES, parseKanban, type KanbanModel, type KanbanPriority } from './kanban-parser';
import { applyKanbanEdit, type KanbanEdit, type KanbanEditResult } from './kanban-edit';
import { kanbanElementFor, kanbanTargetAt, type KanbanTarget } from './kanban-svg';
import { parseRich, hasFormatting, richToPlain } from './rich-text';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';
import { HIDDEN_BAR, HIDDEN_FORM, type ActionsBarState, type ChoiceOption, type FormAction, type FormPopoverState } from './form';

// Columns by index, cards by (column, position in it) — what the edit
// engine keys on.
type Selection = { kind: 'column'; column: number } | { kind: 'card'; column: number; card: number } | null;

const PRIORITY_LABEL: Record<KanbanPriority, string> = {
  'Very High': 'Very high',
  High: 'High',
  Low: 'Low',
  'Very Low': 'Very low',
};

// A blank label (written as one space) edits as an empty field.
function richValue(md: string): string {
  return md.trim() === '' ? '' : md;
}

// A label as plain text, for pickers.
function plain(md: string): string {
  const text = richToPlain(parseRich(md)).trim();
  return text || 'Untitled';
}

export class KanbanController implements DiagramController {
  private host: DiagramHost;
  // Latest successfully-parsed board; null in fallback mode.
  private model: KanbanModel | null = null;
  private selected: Selection = null;
  // See FlowchartController.pendingSelect.
  private pendingSelect: Exclude<Selection, null> | null = null;
  private form: MountedUi<FormPopoverState>;
  private actions: MountedUi<ActionsBarState>;

  constructor(host: DiagramHost) {
    this.host = host;
    this.form = mountUi(host, MermaidFormPopover, 'mermaid-popover-host mermaid-form-popover-host', HIDDEN_FORM);
    this.actions = mountUi(host, MermaidActionsBar, 'mermaid-popover-host mermaid-actions-host', HIDDEN_BAR);
  }

  load(source: string): boolean {
    const parsed = parseKanban(source);
    this.model = parsed.ok ? parsed.model : null;
    return parsed.ok;
  }

  // A fresh `kanban` with no columns: offer the first one.
  emptyState(): EmptyState | null {
    if (!this.model || this.model.columns.length > 0) return null;
    return { label: '+ Add the first column', onActivate: () => this.addColumn() };
  }

  rendered(): void {
    const pending = this.pendingSelect;
    this.pendingSelect = null;
    if (pending && this.exists(pending)) {
      this.select(pending);
    } else if (this.selected) {
      if (this.exists(this.selected)) this.select(this.selected);
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
    const hit = svg && this.model ? kanbanTargetAt(target, svg, this.model) : null;
    if (hit) {
      this.select(hit.kind === 'column' ? { kind: 'column', column: hit.column } : { kind: 'card', column: hit.column, card: hit.card });
      return true;
    }
    this.clearSelection();
    return false;
  }

  destroy(): void {
    this.form.destroy();
    this.actions.destroy();
  }

  // ── selection ──────────────────────────────────────────────────────

  private exists(sel: Exclude<Selection, null>): boolean {
    const col = this.model?.columns[sel.column];
    return !!col && (sel.kind === 'column' || !!col.cards[sel.card]);
  }

  private element(sel: Exclude<Selection, null>): Element | null {
    const svg = this.host.renderedEl.querySelector('svg');
    if (!svg || !this.model) return null;
    const target: KanbanTarget = sel.kind === 'column' ? { kind: 'column', column: sel.column } : { kind: 'card', column: sel.column, card: sel.card };
    return kanbanElementFor(svg, this.model, target);
  }

  private select(sel: Exclude<Selection, null>): void {
    this.selected = sel;
    this.host.dom.classList.add('mermaid-has-selection');
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    const el = this.element(sel);
    el?.classList.add('mermaid-selected');
    if (sel.kind === 'column') this.openColumnPopover(sel.column, el);
    else this.openCardPopover(sel.column, sel.card, el);
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

  // ── popovers ───────────────────────────────────────────────────────

  private openColumnPopover(ci: number, el: Element | null): void {
    const model = this.model;
    const col = model?.columns[ci];
    if (!model || !col) return;
    // Anchored at the header, so it doesn't cover the cards.
    const { x, y } = this.host.anchor(el?.querySelector('.cluster-label') ?? el, 'right');
    const actions: FormAction[] = [
      {
        id: 'add-card',
        label: 'Add card',
        icon: 'plus',
        onClick: () => this.commit({ kind: 'addCard', column: ci, text: '' }, (r) => this.pend(r)),
      },
    ];
    if (ci > 0) {
      actions.push({ id: 'move-left', label: 'Move left', icon: 'left', onClick: () => this.commit({ kind: 'moveColumn', column: ci, to: ci - 1 }, (r) => this.pend(r)) });
    }
    if (ci < model.columns.length - 1) {
      actions.push({ id: 'move-right', label: 'Move right', icon: 'right', onClick: () => this.commit({ kind: 'moveColumn', column: ci, to: ci + 1 }, (r) => this.pend(r)) });
    }
    actions.push({
      id: 'delete-column',
      label: col.cards.length ? 'Delete column (and its cards)' : 'Delete column',
      icon: 'trash',
      danger: true,
      onClick: () => {
        this.dropSelection();
        this.commit({ kind: 'deleteColumn', column: ci });
      },
    });
    this.form.show({
      visible: true,
      x,
      y,
      key: `column:${ci}`,
      title: 'Column',
      fields: [
        {
          kind: 'rich',
          id: 'name',
          label: 'Name',
          value: richValue(col.richText),
          placeholder: 'Column name',
          className: 'mermaid-kanban-column-name',
          onCommit: (md) => this.commitRich(md, (text, markdown) => ({ kind: 'renameColumn', column: ci, text, markdown })),
        },
      ],
      actions,
      onClose: () => this.form.hide(),
    });
  }

  private openCardPopover(ci: number, ki: number, el: Element | null): void {
    const model = this.model;
    const card = model?.columns[ci]?.cards[ki];
    if (!model || !card) return;
    const { x, y } = this.host.anchor(el, 'right');
    const count = model.columns[ci].cards.length;
    const priorities: ChoiceOption[] = [
      { value: '', label: 'None' },
      ...KANBAN_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
    ];
    // A priority mermaid accepts but the picker doesn't offer: show it
    // as it is (picking another one replaces it).
    if (card.priority && !priorities.some((o) => o.value === card.priority)) priorities.push({ value: card.priority, label: card.priority });
    const actions: FormAction[] = [];
    if (ki > 0) actions.push({ id: 'move-up', label: 'Move up', icon: 'up', onClick: () => this.moveCard(ci, ki, ci, ki - 1) });
    if (ki < count - 1) actions.push({ id: 'move-down', label: 'Move down', icon: 'down', onClick: () => this.moveCard(ci, ki, ci, ki + 1) });
    actions.push({
      id: 'delete-card',
      label: 'Delete card',
      icon: 'trash',
      danger: true,
      onClick: () => {
        this.dropSelection();
        this.commit({ kind: 'deleteCard', column: ci, card: ki });
      },
    });
    this.form.show({
      visible: true,
      x,
      y,
      key: `card:${ci}:${ki}`,
      title: 'Card',
      fields: [
        {
          kind: 'rich',
          id: 'text',
          label: 'Text',
          value: richValue(card.richText),
          placeholder: 'What needs doing',
          className: 'mermaid-kanban-card-text',
          onCommit: (md) => this.commitRich(md, (text, markdown) => ({ kind: 'renameCard', column: ci, card: ki, text, markdown })),
        },
        {
          kind: 'text',
          id: 'assigned',
          label: 'Assigned to',
          value: card.assigned ?? '',
          placeholder: 'Nobody',
          className: 'mermaid-kanban-assigned',
          onCommit: (assigned) => this.commit({ kind: 'setCardMeta', column: ci, card: ki, assigned: assigned.trim() }),
        },
        {
          kind: 'text',
          id: 'ticket',
          label: 'Ticket',
          value: card.ticket ?? '',
          placeholder: 'None',
          className: 'mermaid-kanban-ticket',
          onCommit: (ticket) => this.commit({ kind: 'setCardMeta', column: ci, card: ki, ticket: ticket.trim() }),
        },
        {
          kind: 'choice',
          id: 'priority',
          label: 'Priority',
          display: 'select',
          value: card.priority ?? '',
          options: priorities,
          onChange: (p) => {
            if (p === '' || (KANBAN_PRIORITIES as readonly string[]).includes(p)) {
              this.commit({ kind: 'setCardMeta', column: ci, card: ki, priority: p as KanbanPriority | '' });
            }
          },
        },
        {
          kind: 'choice',
          id: 'column',
          label: 'Column',
          display: 'select',
          value: String(ci),
          options: model.columns.map((c) => ({ value: String(c.index), label: plain(c.richText) })),
          onChange: (v) => {
            const to = Number(v);
            // To the end of the chosen column.
            if (to !== ci) this.moveCard(ci, ki, to, model.columns[to]?.cards.length ?? 0);
          },
        },
      ],
      actions,
      onClose: () => this.form.hide(),
    });
  }

  private refreshActions(): void {
    if (!this.model || this.model.columns.length === 0) {
      this.actions.hide();
      return;
    }
    this.actions.show({
      visible: true,
      ariaLabel: 'Board actions',
      items: [{ id: 'add-column', label: 'Column', icon: 'plus', onClick: () => this.addColumn() }],
    });
  }

  // ── edits ──────────────────────────────────────────────────────────

  // `beforeCommit` runs with the edit's result before the transaction is
  // dispatched (see FlowchartController.commit).
  private commit(edit: KanbanEdit, beforeCommit?: (result: KanbanEditResult) => void): void {
    if (!this.model) return;
    const source = this.host.source();
    if (source == null) return;
    const result = applyKanbanEdit(source, edit);
    if (!result) return;
    beforeCommit?.(result);
    this.host.commit(result.source);
  }

  // Select what an edit created or moved once it's drawn.
  private pend(r: KanbanEditResult): void {
    if (r.column === undefined) return;
    this.pendingSelect = r.card === undefined ? { kind: 'column', column: r.column } : { kind: 'card', column: r.column, card: r.card };
    this.selected = this.pendingSelect;
  }

  // A rich field's markdown → plain text, or markdown when it has bold /
  // italic in it.
  private commitRich(md: string, make: (text: string, markdown: boolean) => KanbanEdit): void {
    const runs = parseRich(md);
    const markdown = hasFormatting(runs);
    this.commit(make(markdown ? md : richToPlain(runs), markdown));
  }

  private moveCard(column: number, card: number, toColumn: number, toPosition: number): void {
    this.commit({ kind: 'moveCard', column, card, toColumn, toPosition }, (r) => this.pend(r));
  }

  // A new, empty column at the end, its popover open for naming.
  private addColumn(): void {
    this.commit({ kind: 'addColumn', text: '' }, (r) => this.pend(r));
  }
}
