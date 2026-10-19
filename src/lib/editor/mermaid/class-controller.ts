// Class-diagram editing (see controller.ts for the contract). Clicking a
// class opens its popover — name, kind of class, members table,
// namespace — and a member row opens it focused on that row; clicking a
// relationship opens its kind picker, end counts and label; clicking a
// note edits its text. Every change is a source-preserving edit from
// class-edit.ts committed through the node view, whose re-render brings
// the new SVG back here. Nothing shown is mermaid syntax: kinds are
// plain words, visibility is "public" / "private" / …
import MermaidFormPopover from '../../../components/MermaidFormPopover.svelte';
import MermaidActionsBar from '../../../components/MermaidActionsBar.svelte';
import MermaidConnectBanner from '../../../components/MermaidConnectBanner.svelte';
import {
  parseClass,
  type ClassClassifier,
  type ClassDirection,
  type ClassMember,
  type ClassModel,
  type ClassVisibility,
} from './class-parser';
import {
  applyClassEdit,
  classRelationType,
  type ClassEdit,
  type ClassEditResult,
  type ClassMemberInput,
  type ClassRelationType,
} from './class-edit';
import { classElementFor, classTargetAt, type ClassTarget } from './class-svg';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';
import { HIDDEN_BANNER, type BannerState } from './flowchart-controller';
import {
  HIDDEN_BAR,
  HIDDEN_FORM,
  type ActionsBarState,
  type ChoiceOption,
  type FormField,
  type FormPopoverState,
  type RowValue,
} from './form';

// Relations and notes are identified by INDEX — parallel relations
// share their ends, and the index is what the edit engine keys on.
type Selection =
  | { kind: 'class'; id: string }
  | { kind: 'relation'; index: number }
  | { kind: 'note'; index: number }
  | null;

const KINDS: Array<{ value: ClassRelationType; label: string }> = [
  { value: 'inheritance', label: 'Inheritance' },
  { value: 'realization', label: 'Implementation' },
  { value: 'composition', label: 'Composition' },
  { value: 'aggregation', label: 'Aggregation' },
  { value: 'association', label: 'Association' },
  { value: 'dependency', label: 'Dependency' },
  { value: 'link', label: 'Link' },
  { value: 'dashedLink', label: 'Dashed link' },
];

const VISIBILITIES: ChoiceOption[] = [
  { value: 'public', label: 'public' },
  { value: 'private', label: 'private' },
  { value: 'protected', label: 'protected' },
  { value: 'package', label: 'package' },
  { value: 'none', label: '—' },
];

const MODIFIERS: ChoiceOption[] = [
  { value: 'none', label: '—' },
  { value: 'static', label: 'static' },
  { value: 'abstract', label: 'abstract' },
];

// The kinds of class mermaid users usually mark (the `<<…>>` above the
// name); anything else is "Custom".
const ANNOTATIONS: ChoiceOption[] = [
  { value: '', label: 'Plain class' },
  { value: 'interface', label: 'Interface' },
  { value: 'abstract', label: 'Abstract' },
  { value: 'service', label: 'Service' },
  { value: 'enumeration', label: 'Enumeration' },
  { value: 'custom', label: 'Custom…' },
];

// Multiplicities offered under each end's text field.
const COUNT_SUGGESTIONS = ['1', '0..1', '*', '1..*'];

const DIRECTIONS: Array<{ value: ClassDirection; label: string; icon: 'down' | 'right' | 'up' | 'left' }> = [
  { value: 'TB', label: 'Top to bottom', icon: 'down' },
  { value: 'LR', label: 'Left to right', icon: 'right' },
  { value: 'BT', label: 'Bottom to top', icon: 'up' },
  { value: 'RL', label: 'Right to left', icon: 'left' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

export class ClassController implements DiagramController {
  private host: DiagramHost;
  // Latest successfully-parsed model; null in fallback mode.
  private model: ClassModel | null = null;
  private selected: Selection = null;
  // Selection to apply once the in-flight render completes (add flows
  // know the new item before its SVG exists).
  private pendingSelect: Exclude<Selection, null> | null = null;
  // Member to focus in the class popover once it is (re)shown: a model
  // member index.
  private focusMember: number | null = null;
  // The class popover shows the custom annotation field.
  private customAnnotation = false;
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
    const parsed = parseClass(source);
    this.model = parsed.ok ? parsed.model : null;
    return parsed.ok;
  }

  // A class diagram without classes or notes (only `direction`, say).
  emptyState(): EmptyState | null {
    if (!this.model || this.model.classes.size > 0 || this.model.notes.length > 0) return null;
    return { label: '+ Add first class', onActivate: () => this.addClass() };
  }

  rendered(): void {
    this.injectEdgeHitTargets();
    // A pending select (from an add flow) beats restoring the previous
    // one; a stale one (undo in between) falls through.
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
    // Connect mode: a class (or one of its rows) is the other end;
    // anything else cancels. Checked before normal selection.
    if (this.connectMode) {
      const to = hit?.kind === 'class' ? hit.id : hit?.kind === 'member' ? hit.classId : null;
      const from = this.connectMode.from;
      this.exitConnectMode();
      if (to && this.model) {
        const index = this.model.relations.length;
        this.commit({ kind: 'addRelation', from, to, type: 'association' }, () => {
          this.pendingSelect = { kind: 'relation', index };
        });
      }
      return true;
    }
    if (!hit) {
      this.clearSelection();
      return false;
    }
    if (hit.kind === 'member') {
      this.focusMember = hit.index;
      this.select({ kind: 'class', id: hit.classId });
    } else if (hit.kind === 'class') {
      this.select({ kind: 'class', id: hit.id });
    } else if (hit.kind === 'relation' || hit.kind === 'cardinality') {
      this.select({ kind: 'relation', index: hit.index });
    } else if (hit.kind === 'note') {
      this.select({ kind: 'note', index: hit.index });
    } else {
      // Namespaces have nothing to edit on their own.
      this.clearSelection();
      return false;
    }
    return true;
  }

  destroy(): void {
    this.exitConnectMode();
    this.form.destroy();
    this.banner.destroy();
    this.actions.destroy();
  }

  // ── hit testing ────────────────────────────────────────────────────

  private svg(): SVGSVGElement | null {
    return this.host.renderedEl.querySelector('svg');
  }

  private hitTest(target: Element): ClassTarget | null {
    const svg = target.closest('svg') as SVGSVGElement | null;
    if (!this.model || !svg) return null;
    return classTargetAt(target, svg, this.model);
  }

  private element(target: ClassTarget): Element | null {
    const svg = this.svg();
    const el = svg && this.model ? classElementFor(svg, this.model, target) : null;
    // A relationship's wide hit twin sits right before the visible line.
    return el?.classList.contains('mermaid-edge-hit') ? el.nextElementSibling : el;
  }

  // ── selection ──────────────────────────────────────────────────────

  private exists(sel: Exclude<Selection, null>): boolean {
    if (!this.model) return false;
    if (sel.kind === 'class') return this.model.classes.has(sel.id);
    if (sel.kind === 'relation') return sel.index < this.model.relations.length;
    return sel.index < this.model.notes.length;
  }

  private select(sel: Exclude<Selection, null>): void {
    if (this.selected?.kind !== 'class' || sel.kind !== 'class' || this.selected.id !== sel.id) this.customAnnotation = false;
    this.selected = sel;
    this.host.dom.classList.add('mermaid-has-selection');
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    if (sel.kind === 'class') this.openClassPopover(sel.id);
    else if (sel.kind === 'relation') this.openRelationPopover(sel.index);
    else this.openNotePopover(sel.index);
  }

  private clearSelection(): void {
    this.selected = null;
    this.focusMember = null;
    this.customAnnotation = false;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    this.form.hide();
  }

  // Deletes make the selection stale — drop it BEFORE committing so the
  // re-render (synchronous on a cache hit) doesn't select whatever
  // moves into its place.
  private dropSelection(): void {
    this.selected = null;
    this.focusMember = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.form.hide();
  }

  private highlight(el: Element | null): void {
    el?.classList.add('mermaid-selected');
  }

  // ── class popover ──────────────────────────────────────────────────

  // Rows as drawn: fields first, then methods (model order within each).
  private rowOrder(id: string): number[] {
    const members = this.model?.classes.get(id)?.members ?? [];
    const idx = members.map((_m, i) => i);
    return [...idx.filter((i) => members[i].kind === 'field'), ...idx.filter((i) => members[i].kind === 'method')];
  }

  private openClassPopover(id: string): void {
    const model = this.model;
    const c = model?.classes.get(id);
    if (!model || !c) return;
    const box = this.element({ kind: 'class', id, part: 'box' });
    this.highlight(box);
    const order = this.rowOrder(id);
    const focus = this.focusMember;
    this.focusMember = null;
    if (focus !== null) this.highlight(this.element({ kind: 'member', classId: id, index: focus }));
    const { x, y } = this.host.anchor(box, 'right');

    const annotation = c.annotations[0] ?? '';
    const standard = ANNOTATIONS.some((a) => a.value === annotation && a.value !== 'custom');
    const custom = this.customAnnotation || !standard;
    const fields: FormField[] = [
      {
        kind: 'text',
        id: 'name',
        label: 'Name',
        value: c.label,
        className: 'mermaid-class-name',
        onCommit: (label) => this.commit({ kind: 'setClassLabel', id, label }),
      },
      {
        kind: 'choice',
        id: 'annotation',
        label: 'Kind of class',
        display: 'select',
        value: custom ? 'custom' : annotation,
        options: ANNOTATIONS,
        onChange: (value) => {
          if (value === 'custom') {
            this.customAnnotation = true;
            this.select({ kind: 'class', id });
          } else {
            this.customAnnotation = false;
            this.commit({ kind: 'setAnnotation', classId: id, annotation: value });
          }
        },
      },
    ];
    if (custom) {
      fields.push({
        kind: 'text',
        id: 'annotation-text',
        label: 'Shown as',
        value: standard ? '' : annotation,
        placeholder: 'e.g. Data store',
        className: 'mermaid-class-annotation',
        onCommit: (text) => this.commit({ kind: 'setAnnotation', classId: id, annotation: text }),
      });
    }
    if (model.namespaces.length) {
      fields.push({
        kind: 'choice',
        id: 'namespace',
        label: 'Namespace',
        display: 'select',
        value: c.namespace ?? '',
        options: [{ value: '', label: 'No namespace' }, ...model.namespaces.map((n) => ({ value: n.id, label: n.id }))],
        onChange: (value) => this.commit({ kind: 'setClassNamespace', id, namespace: value || null }),
      });
    }
    fields.push({
      kind: 'rows',
      id: 'members',
      label: 'Members',
      columns: [
        { id: 'visibility', label: 'Visibility', kind: 'choice', options: VISIBILITIES },
        { id: 'kind', label: 'Kind', kind: 'choice', options: [{ value: 'field', label: 'field' }, { value: 'method', label: 'method' }] },
        { id: 'name', label: 'Name', kind: 'text', width: '7em' },
        { id: 'type', label: 'Type', kind: 'text', placeholder: 'type / returns', width: '6em' },
        { id: 'parameters', label: 'Parameters', kind: 'text', placeholder: 'methods', width: '6em' },
        { id: 'modifier', label: 'Modifier', kind: 'choice', options: MODIFIERS },
      ],
      rows: order.map((i) => {
        const m = c.members[i];
        return { visibility: m.visibility, kind: m.kind, name: m.name, type: m.type, parameters: m.parameters, modifier: m.classifier };
      }),
      addLabel: 'Add member',
      onCell: (row, column, value) => this.editMember(id, order[row], column, value),
      onAdd: () => {
        this.focusMember = c.members.length;
        this.commit({ kind: 'addMember', classId: id, member: { kind: 'field', visibility: 'public', classifier: 'none', name: 'newField', type: '', parameters: '' } });
      },
      onRemove: (row) => this.commit({ kind: 'removeMember', classId: id, index: order[row] }),
      // Fields and methods are drawn in separate groups: a move only
      // means something within one.
      onMove: (row, to) => {
        const a = c.members[order[row]];
        const b = c.members[order[to]];
        if (a && b && a.kind === b.kind) this.commit({ kind: 'moveMember', classId: id, from: order[row], to: order[to] });
      },
    });

    this.form.show({
      visible: true,
      x,
      y,
      key: `class:${id}`,
      title: 'Class',
      fields,
      actions: [
        { id: 'connect', label: 'Connect to…', icon: 'link', onClick: () => this.enterConnectMode(id) },
        {
          id: 'add-note',
          label: 'Add note',
          icon: 'note',
          onClick: () => this.addNote(id),
        },
        {
          id: 'delete',
          label: 'Delete class',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteClass', id });
          },
        },
      ],
      onClose: () => this.clearSelection(),
    });
    if (focus !== null) this.focusRow(order.indexOf(focus));
  }

  // Focus the name cell of table row `row` once the popover is drawn.
  private focusRow(row: number): void {
    if (row < 0) return;
    setTimeout(() => {
      const input = this.host.dom.querySelector<HTMLInputElement>(
        `.mermaid-form-popover [data-field="members"] tr[data-row="${row}"] input[aria-label="Name"]`,
      );
      input?.focus();
    }, 0);
  }

  private editMember(id: string, index: number, column: string, value: RowValue): void {
    const m = this.model?.classes.get(id)?.members[index];
    if (!m) return;
    const next: ClassMemberInput = {
      kind: m.kind,
      visibility: m.visibility,
      classifier: m.classifier,
      name: m.name,
      type: m.type,
      parameters: m.parameters,
    };
    const v = String(value);
    if (column === 'visibility') next.visibility = v as ClassVisibility;
    else if (column === 'kind') next.kind = v as ClassMember['kind'];
    else if (column === 'modifier') next.classifier = v as ClassClassifier;
    else if (column === 'name') next.name = v;
    else if (column === 'type') next.type = v;
    else if (column === 'parameters') {
      // Parameters make it a method.
      next.parameters = v;
      if (v.trim()) next.kind = 'method';
    }
    this.focusMember = index;
    this.commit({ kind: 'setMember', classId: id, index, member: next });
  }

  // ── relation popover ───────────────────────────────────────────────

  private labelOf(id: string): string {
    return this.model?.classes.get(id)?.label ?? id;
  }

  // The relationship in words: "Dog inherits from Animal".
  private describe(index: number): string {
    const r = this.model?.relations[index];
    if (!r) return '';
    const from = this.labelOf(r.from);
    const to = this.labelOf(r.to);
    if (r.fromMarker === 'lollipop') return `${to} provides the ${from} interface`;
    if (r.toMarker === 'lollipop') return `${from} provides the ${to} interface`;
    const type = classRelationType(r);
    // The marked end and the other one.
    const [at, other] = r.fromMarker !== 'none' ? [from, to] : [to, from];
    switch (type) {
      case 'inheritance':
        return `${other} inherits from ${at}`;
      case 'realization':
        return `${other} implements ${at}`;
      case 'composition':
        return `${at} is made of ${other}`;
      case 'aggregation':
        return `${at} has ${other}`;
      case 'association':
        return `${other} is associated with ${at}`;
      case 'dependency':
        return `${other} depends on ${at}`;
      case 'link':
      case 'dashedLink':
        return `${from} is linked to ${to}`;
      default:
        return `${from} and ${to} are related`;
    }
  }

  private openRelationPopover(index: number): void {
    const r = this.model?.relations[index];
    if (!r) return;
    const line = this.element({ kind: 'relation', index, part: 'line' });
    this.highlight(line);
    const { x, y } = this.host.anchor(this.element({ kind: 'relation', index, part: 'label' }) ?? line, 'center');
    const lollipop = r.fromMarker === 'lollipop' || r.toMarker === 'lollipop';
    const setCards = (from: string, to: string) => this.commit({ kind: 'setRelationCardinality', index, from, to });
    const countFields = (end: 'from' | 'to'): FormField[] => {
      const value = end === 'from' ? r.fromCardinality : r.toCardinality;
      const set = (v: string) => (end === 'from' ? setCards(v, r.toCardinality) : setCards(r.fromCardinality, v));
      return [
        {
          kind: 'text',
          id: `${end}-card`,
          label: `How many ${this.labelOf(end === 'from' ? r.from : r.to)}`,
          value,
          placeholder: 'e.g. 1 or 0..*',
          className: `mermaid-${end}-card`,
          onCommit: set,
        },
        {
          kind: 'choice',
          id: `${end}-card-suggest`,
          value,
          options: [...COUNT_SUGGESTIONS.map((s) => ({ value: s, label: s })), { value: '', label: 'none' }],
          onChange: set,
        },
      ];
    };
    const fields: FormField[] = [{ kind: 'hint', id: 'sentence', text: this.describe(index) }];
    if (!lollipop) {
      fields.push({
        kind: 'choice',
        id: 'kind',
        label: 'Kind',
        value: classRelationType(r) ?? '',
        options: KINDS,
        onChange: (type) => this.commit({ kind: 'setRelationType', index, type: type as ClassRelationType }),
      });
    }
    fields.push(...countFields('from'), ...countFields('to'), {
      kind: 'text',
      id: 'label',
      label: 'Label',
      value: r.label,
      placeholder: 'e.g. owns',
      className: 'mermaid-relation-label',
      onCommit: (label) => this.commit({ kind: 'setRelationLabel', index, label }),
    });
    const actions = lollipop ? [] : [{ id: 'flip', label: 'Flip direction', icon: 'swap' as const, onClick: () => this.commit({ kind: 'flipRelation', index }) }];
    this.form.show({
      visible: true,
      x,
      y,
      key: `relation:${index}`,
      title: 'Relationship',
      fields,
      actions: [
        ...actions,
        {
          id: 'delete',
          label: 'Delete relationship',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteRelation', index });
          },
        },
      ],
      onClose: () => this.clearSelection(),
    });
  }

  // ── note popover ───────────────────────────────────────────────────

  private openNotePopover(index: number): void {
    const n = this.model?.notes[index];
    if (!n) return;
    const el = this.element({ kind: 'note', index });
    this.highlight(el);
    const { x, y } = this.host.anchor(el, 'right');
    this.form.show({
      visible: true,
      x,
      y,
      key: `note:${index}`,
      title: 'Note',
      fields: [
        {
          kind: 'text',
          id: 'text',
          label: 'Text',
          value: n.text,
          className: 'mermaid-note-text',
          onCommit: (text) => this.commit({ kind: 'setNoteText', index, text }),
        },
      ],
      actions: [
        {
          id: 'delete',
          label: 'Delete note',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteNote', index });
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
      ariaLabel: 'Class diagram actions',
      align: 'left',
      items: [
        { id: 'add-class', label: 'Class', icon: 'plus', onClick: () => this.addClass() },
        { id: 'add-note', label: 'Note', icon: 'note', onClick: () => this.addNote() },
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

  // `beforeCommit` runs with the result before the transaction is
  // dispatched (the render may complete synchronously on a cache hit),
  // so add flows can stash pendingSelect first.
  private commit(edit: ClassEdit, beforeCommit?: (result: ClassEditResult) => void): void {
    if (!this.model) return;
    const source = this.host.source();
    if (source == null) return;
    const result = applyClassEdit(source, edit);
    if (!result) return;
    beforeCommit?.(result);
    this.host.commit(result.source);
  }

  private addClass(): void {
    this.commit({ kind: 'addClass', label: 'New class' }, (r) => {
      if (r.id) this.pendingSelect = { kind: 'class', id: r.id };
    });
  }

  private addNote(classId?: string): void {
    this.commit({ kind: 'addNote', text: 'Note', ...(classId ? { classId } : {}) }, (r) => {
      if (r.index !== undefined) this.pendingSelect = { kind: 'note', index: r.index };
    });
  }

  // ── connect mode ───────────────────────────────────────────────────

  private enterConnectMode(from: string): void {
    this.connectMode = { from };
    this.host.dom.classList.add('mermaid-connect-mode');
    this.form.hide();
    this.banner.show({
      visible: true,
      hint: 'Click a class to connect to',
      addLabel: 'New class',
      onAddNewNode: () => this.addConnectedClass(),
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

  // Class + relationship in ONE edit (one transaction, one render); the
  // relationship's popover opens so its kind can be picked.
  private addConnectedClass(): void {
    if (!this.connectMode || !this.model) return;
    const from = this.connectMode.from;
    const index = this.model.relations.length;
    this.exitConnectMode();
    this.commit({ kind: 'addClass', label: 'New class', relation: { other: from, type: 'association', newIs: 'to' } }, () => {
      this.pendingSelect = { kind: 'relation', index };
    });
  }

  // Relationship lines are 1px paths: give each a wide transparent twin
  // (same data-id, so hit testing treats it identically) behind it.
  private injectEdgeHitTargets(): void {
    this.host.renderedEl.querySelectorAll('.edgePaths path.relation[data-id]').forEach((path) => {
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
