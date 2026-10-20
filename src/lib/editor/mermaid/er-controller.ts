// ER-diagram editing (see controller.ts for the contract). Clicking an
// entity opens its popover — name and attributes table — and an
// attribute row opens it focused on that row; clicking a relationship
// opens both ends' cardinalities, the line kind and the label. Changes
// are source-preserving edits from er-edit.ts committed through the
// node view. Nothing shown is mermaid syntax: cardinalities are plain
// words ("zero or more"), the line kind is "Solid line (identifying)".
// Attribute types and names are single words in the diagram; what the
// engine stores (sanitizeErWord) is what the cell shows after commit.
import MermaidFormPopover from '../../../components/MermaidFormPopover.svelte';
import MermaidActionsBar from '../../../components/MermaidActionsBar.svelte';
import MermaidConnectBanner from '../../../components/MermaidConnectBanner.svelte';
import { parseEr, type ErCardinality, type ErDirection, type ErKey, type ErModel } from './er-parser';
import { applyErEdit, type ErAttributeInput, type ErCardinalityInput, type ErEdit, type ErEditResult } from './er-edit';
import { erElementFor, erTargetAt, type ErTarget } from './er-svg';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';
import { HIDDEN_BANNER, type BannerState } from './flowchart-controller';
import { HIDDEN_BAR, HIDDEN_FORM, type ActionsBarState, type ChoiceOption, type FormPopoverState, type RowValue } from './form';

type Selection = { kind: 'entity'; id: string } | { kind: 'relationship'; index: number } | null;

const CARDINALITIES: Array<{ value: ErCardinalityInput; label: string }> = [
  { value: 'exactly-one', label: 'exactly one' },
  { value: 'zero-or-one', label: 'zero or one' },
  { value: 'zero-or-more', label: 'zero or more' },
  { value: 'one-or-more', label: 'one or more' },
];

const KEYS: ErKey[] = ['PK', 'FK', 'UK'];

const DIRECTIONS: Array<{ value: ErDirection; label: string; icon: 'down' | 'right' | 'up' | 'left' }> = [
  { value: 'TB', label: 'Top to bottom', icon: 'down' },
  { value: 'LR', label: 'Left to right', icon: 'right' },
  { value: 'BT', label: 'Bottom to top', icon: 'up' },
  { value: 'RL', label: 'Right to left', icon: 'left' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

export class ErController implements DiagramController {
  private host: DiagramHost;
  private model: ErModel | null = null;
  private selected: Selection = null;
  // Selection to apply once the in-flight render completes.
  private pendingSelect: Exclude<Selection, null> | null = null;
  // Attribute row to focus when the entity popover is (re)shown.
  private focusAttribute: number | null = null;
  // Non-null while the user picks the other end of a new relationship.
  private connectMode: { from: string } | null = null;
  private form: MountedUi<FormPopoverState>;
  private banner: MountedUi<BannerState>;
  private actions: MountedUi<ActionsBarState>;

  constructor(host: DiagramHost) {
    this.host = host;
    this.form = mountUi(host, MermaidFormPopover, 'mermaid-popover-host mermaid-form-popover-host', HIDDEN_FORM);
    this.banner = mountUi(host, MermaidConnectBanner, 'mermaid-popover-host mermaid-connect-banner-host', HIDDEN_BANNER);
    this.actions = mountUi(host, MermaidActionsBar, 'mermaid-popover-host mermaid-actions-host', HIDDEN_BAR);
  }

  load(source: string): boolean {
    const parsed = parseEr(source);
    this.model = parsed.ok ? parsed.model : null;
    return parsed.ok;
  }

  // A fresh `erDiagram` has nothing to click.
  emptyState(): EmptyState | null {
    if (!this.model || this.model.entities.size > 0) return null;
    return { label: '+ Add first entity', onActivate: () => this.addEntity() };
  }

  rendered(): void {
    this.injectEdgeHitTargets();
    const pending = this.pendingSelect;
    this.pendingSelect = null;
    if (pending && this.exists(pending)) {
      this.select(pending);
    } else if (this.selected) {
      if (this.exists(this.selected)) this.select(this.selected);
      else this.clearSelection();
    }
    this.refreshToolbar();
  }

  cleared(): void {
    this.pendingSelect = null;
    this.clearSelection();
    this.actions.hide();
  }

  click(target: Element): boolean {
    const hit = this.hitTest(target);
    if (this.connectMode) {
      const to = hit?.kind === 'entity' ? hit.id : hit?.kind === 'attribute' ? hit.entityId : null;
      const from = this.connectMode.from;
      this.exitConnectMode();
      if (to && this.model) {
        const index = this.model.relationships.length;
        this.commit({ kind: 'addRelationship', from, to }, () => {
          this.pendingSelect = { kind: 'relationship', index };
        });
      }
      return true;
    }
    if (!hit) {
      this.clearSelection();
      return false;
    }
    if (hit.kind === 'attribute') {
      this.focusAttribute = hit.index;
      this.select({ kind: 'entity', id: hit.entityId });
    } else if (hit.kind === 'entity') {
      this.select({ kind: 'entity', id: hit.id });
    } else {
      this.select({ kind: 'relationship', index: hit.index });
    }
    return true;
  }

  destroy(): void {
    this.exitConnectMode();
    this.form.destroy();
    this.banner.destroy();
    this.actions.destroy();
  }

  // ── hit testing / selection ────────────────────────────────────────

  private hitTest(target: Element): ErTarget | null {
    const svg = target.closest('svg') as SVGSVGElement | null;
    if (!this.model || !svg) return null;
    return erTargetAt(target, svg, this.model);
  }

  private element(target: ErTarget): Element | null {
    const svg = this.host.renderedEl.querySelector('svg');
    const el = svg && this.model ? erElementFor(svg, this.model, target) : null;
    // A relationship's wide hit twin sits right before the visible line.
    return el?.classList.contains('mermaid-edge-hit') ? el.nextElementSibling : el;
  }

  private exists(sel: Exclude<Selection, null>): boolean {
    if (!this.model) return false;
    return sel.kind === 'entity' ? this.model.entities.has(sel.id) : sel.index < this.model.relationships.length;
  }

  private select(sel: Exclude<Selection, null>): void {
    this.selected = sel;
    this.host.dom.classList.add('mermaid-has-selection');
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    if (sel.kind === 'entity') this.openEntityPopover(sel.id);
    else this.openRelationshipPopover(sel.index);
  }

  private clearSelection(): void {
    this.selected = null;
    this.focusAttribute = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    this.form.hide();
  }

  // Drop a selection a delete is about to make stale, before committing.
  private dropSelection(): void {
    this.selected = null;
    this.focusAttribute = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.form.hide();
  }

  // ── entity popover ─────────────────────────────────────────────────

  private openEntityPopover(id: string): void {
    const e = this.model?.entities.get(id);
    if (!e) return;
    const box = this.element({ kind: 'entity', id, part: 'box' });
    box?.classList.add('mermaid-selected');
    const focus = this.focusAttribute;
    this.focusAttribute = null;
    if (focus !== null) this.element({ kind: 'attribute', entityId: id, index: focus, cell: 'row' })?.classList.add('mermaid-selected');
    const { x, y } = this.host.anchor(box, 'right');
    const toggle = (k: ErKey): { id: string; label: string; kind: 'toggle' } => ({ id: k, label: k, kind: 'toggle' });
    this.form.show({
      visible: true,
      x,
      y,
      key: `entity:${id}`,
      title: 'Entity',
      fields: [
        {
          kind: 'text',
          id: 'name',
          label: 'Name',
          value: e.label,
          className: 'mermaid-entity-name',
          onCommit: (label) => this.commit({ kind: 'setEntityLabel', id, label }),
        },
        {
          kind: 'rows',
          id: 'attributes',
          label: 'Attributes',
          columns: [
            { id: 'type', label: 'Type', kind: 'text', width: '6em' },
            { id: 'name', label: 'Name', kind: 'text', width: '7em' },
            ...KEYS.map(toggle),
            { id: 'comment', label: 'Comment', kind: 'text', width: '8em' },
          ],
          rows: e.attributes.map((a) => ({
            type: a.type,
            name: a.name,
            PK: a.keys.includes('PK'),
            FK: a.keys.includes('FK'),
            UK: a.keys.includes('UK'),
            comment: a.comment,
          })),
          addLabel: 'Add attribute',
          onCell: (row, column, value) => this.editAttribute(id, row, column, value),
          onAdd: () => {
            this.focusAttribute = e.attributes.length;
            this.commit({ kind: 'addAttribute', entityId: id, attribute: { type: 'string', name: 'attribute', keys: [], comment: '' } });
          },
          onRemove: (row) => this.commit({ kind: 'removeAttribute', entityId: id, index: row }),
          onMove: (row, to) => this.commit({ kind: 'moveAttribute', entityId: id, from: row, to }),
        },
      ],
      actions: [
        { id: 'connect', label: 'Connect to…', icon: 'link', onClick: () => this.enterConnectMode(id) },
        {
          id: 'delete',
          label: 'Delete entity',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteEntity', id });
          },
        },
      ],
      onClose: () => this.clearSelection(),
    });
    if (focus !== null) {
      setTimeout(() => {
        this.host.dom
          .querySelector<HTMLInputElement>(`.mermaid-form-popover [data-field="attributes"] tr[data-row="${focus}"] input[aria-label="Name"]`)
          ?.focus();
      }, 0);
    }
  }

  private editAttribute(id: string, index: number, column: string, value: RowValue): void {
    const a = this.model?.entities.get(id)?.attributes[index];
    if (!a) return;
    const next: ErAttributeInput = { type: a.type, name: a.name, keys: [...a.keys], comment: a.comment };
    if (column === 'type' || column === 'name' || column === 'comment') next[column] = String(value);
    else if (KEYS.includes(column as ErKey)) {
      const k = column as ErKey;
      next.keys = value ? [...next.keys.filter((x) => x !== k), k] : next.keys.filter((x) => x !== k);
    }
    this.focusAttribute = index;
    this.commit({ kind: 'setAttribute', entityId: id, index, attribute: next });
  }

  // ── relationship popover ───────────────────────────────────────────

  private labelOf(id: string): string {
    return this.model?.entities.get(id)?.label ?? id;
  }

  private cardinalityOptions(current: ErCardinality): ChoiceOption[] {
    const options: ChoiceOption[] = [...CARDINALITIES];
    // mermaid's "MD parent" end can't be chosen, only kept.
    if (current === 'md-parent') options.push({ value: 'md-parent', label: 'parent (as written)' });
    return options;
  }

  private openRelationshipPopover(index: number): void {
    const r = this.model?.relationships[index];
    if (!r) return;
    const line = this.element({ kind: 'relationship', index, part: 'line' });
    line?.classList.add('mermaid-selected');
    const { x, y } = this.host.anchor(this.element({ kind: 'relationship', index, part: 'label' }) ?? line, 'center');
    const from = this.labelOf(r.from);
    const to = this.labelOf(r.to);
    const setCard = (side: 'from' | 'to', value: string) => {
      if (value === 'md-parent') return;
      this.commit({ kind: 'setRelationshipCardinality', index, [side]: value as ErCardinalityInput });
    };
    this.form.show({
      visible: true,
      x,
      y,
      key: `relationship:${index}`,
      title: 'Relationship',
      fields: [
        {
          kind: 'choice',
          id: 'from-card',
          label: `${from} side`,
          display: 'select',
          value: r.fromCardinality,
          options: this.cardinalityOptions(r.fromCardinality),
          onChange: (v) => setCard('from', v),
        },
        {
          kind: 'choice',
          id: 'to-card',
          label: `${to} side`,
          display: 'select',
          value: r.toCardinality,
          options: this.cardinalityOptions(r.toCardinality),
          onChange: (v) => setCard('to', v),
        },
        {
          kind: 'toggle',
          id: 'identifying',
          label: 'Solid line (identifying)',
          value: r.identifying,
          onChange: (identifying) => this.commit({ kind: 'setRelationshipIdentifying', index, identifying }),
        },
        {
          kind: 'text',
          id: 'label',
          label: 'Label',
          value: r.label,
          placeholder: 'e.g. places',
          className: 'mermaid-relationship-label',
          onCommit: (label) => this.commit({ kind: 'setRelationshipLabel', index, label }),
        },
      ],
      actions: [
        {
          id: 'delete',
          label: 'Delete relationship',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteRelationship', index });
          },
        },
      ],
      onClose: () => this.clearSelection(),
    });
  }

  // ── toolbar ────────────────────────────────────────────────────────

  private refreshToolbar(): void {
    const model = this.model;
    if (!model) {
      this.actions.hide();
      return;
    }
    this.actions.show({
      visible: true,
      ariaLabel: 'ER diagram actions',
      align: 'left',
      items: [
        { id: 'add-entity', label: 'Entity', icon: 'plus', onClick: () => this.addEntity() },
        ...DIRECTIONS.map((d) => ({
          id: `direction-${d.value}`,
          label: d.label,
          icon: d.icon,
          active: model.direction === d.value,
          onClick: () => this.commit({ kind: 'setDirection', direction: d.value }),
        })),
      ],
    });
  }

  // ── edits ──────────────────────────────────────────────────────────

  // `beforeCommit` runs before the transaction is dispatched (the
  // render may complete synchronously), so add flows set pendingSelect.
  private commit(edit: ErEdit, beforeCommit?: (result: ErEditResult) => void): void {
    if (!this.model) return;
    const source = this.host.source();
    if (source == null) return;
    const result = applyErEdit(source, edit);
    if (!result) return;
    beforeCommit?.(result);
    this.host.commit(result.source);
  }

  private addEntity(): void {
    this.commit({ kind: 'addEntity', label: 'New entity' }, (r) => {
      if (r.id) this.pendingSelect = { kind: 'entity', id: r.id };
    });
  }

  // ── connect mode ───────────────────────────────────────────────────

  private enterConnectMode(from: string): void {
    this.connectMode = { from };
    this.host.dom.classList.add('mermaid-connect-mode');
    this.form.hide();
    this.banner.show({
      visible: true,
      hint: 'Click an entity to connect to',
      addLabel: 'New entity',
      onAddNewNode: () => this.addConnectedEntity(),
      onCancel: () => this.exitConnectMode(),
    });
    this.host.setEscapeHandler(() => this.exitConnectMode());
  }

  private exitConnectMode(): void {
    if (!this.connectMode) return;
    this.connectMode = null;
    this.host.dom.classList.remove('mermaid-connect-mode');
    this.banner.hide();
    this.host.setEscapeHandler(null);
  }

  // Entity + relationship in ONE edit; the relationship's popover opens
  // so its cardinalities can be set.
  private addConnectedEntity(): void {
    if (!this.connectMode || !this.model) return;
    const from = this.connectMode.from;
    const index = this.model.relationships.length;
    this.exitConnectMode();
    this.commit({ kind: 'addEntity', label: 'New entity', relation: { other: from, newIs: 'to' } }, () => {
      this.pendingSelect = { kind: 'relationship', index };
    });
  }

  // Wide transparent twins for the 1px relationship lines.
  private injectEdgeHitTargets(): void {
    this.host.renderedEl.querySelectorAll('.edgePaths path.relationshipLine[data-id]').forEach((path) => {
      const parent = path.parentNode;
      if (!parent) return;
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', path.getAttribute('d') || '');
      hit.setAttribute('class', 'mermaid-edge-hit');
      hit.setAttribute('data-id', path.getAttribute('data-id') || '');
      hit.setAttribute('stroke-width', '14');
      hit.setAttribute('fill', 'none');
      hit.style.pointerEvents = 'stroke';
      parent.insertBefore(hit, path);
    });
  }
}
