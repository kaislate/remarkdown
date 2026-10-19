// State diagram editing (see controller.ts for the contract) — built to
// feel like flowchart-controller.ts. Click a state, a group, a
// transition, a note or a start / end circle and its popover opens;
// "Connect to…" picks the other end of a new transition with the next
// click. Popover edits become source-preserving text changes
// (state-edit.ts) committed through the node view, whose re-render
// brings the new SVG back here. Which SVG element is which item comes
// from state-svg.ts.
//
// Nothing here shows mermaid syntax: `[*]` is "Start" / "End",
// `<<fork>>` is "Fork (split)", a group is a "group".
import MermaidConnectBanner from '../../../components/MermaidConnectBanner.svelte';
import MermaidDirectionPicker from '../../../components/MermaidDirectionPicker.svelte';
import MermaidFormPopover from '../../../components/MermaidFormPopover.svelte';
import MermaidActionsBar from '../../../components/MermaidActionsBar.svelte';
import type { MermaidDirection } from '../mermaid-graph';
import { parseState, type StateDirection, type StateEndpoint, type StateKind, type StateModel, type StateScope } from './state-parser';
import { applyStateEdit, stateTextMarkdown, type StateEdit, type StateEditResult } from './state-edit';
import { stateElementFor, stateTargetAt, type StateTarget } from './state-svg';
import { findPreamble, setFrontmatterTitle } from './source-text';
import { parseRich, richToPlain, serializeRich } from './rich-text';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';
import { HIDDEN_BANNER, type BannerState } from './flowchart-controller';
import { HIDDEN_BAR, HIDDEN_FORM, NEW_GROUP, type ActionsBarState, type ChoiceOption, type FormAction, type FormField, type FormPopoverState } from './form';

type Selection = StateTarget | { kind: 'title' } | null;

interface DirectionPickerState {
  visible: boolean;
  direction: MermaidDirection;
  onDirectionChange: (direction: MermaidDirection) => void;
}

const HIDDEN_DIRECTION: DirectionPickerState = { visible: false, direction: 'TD', onDirectionChange: () => {} };

// The direction picker speaks flowchart (`TD`); state diagrams say `TB`.
const toPicker = (d: StateDirection): MermaidDirection => (d === 'TB' ? 'TD' : d);
const fromPicker = (d: MermaidDirection): StateDirection => (d === 'TD' ? 'TB' : d);

const KINDS: ChoiceOption[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'fork', label: 'Fork (split)' },
  { value: 'join', label: 'Join' },
  { value: 'choice', label: 'Choice' },
];

const DIRECTIONS: ChoiceOption[] = [
  { value: 'TB', label: 'Top to bottom', icon: 'down' },
  { value: 'LR', label: 'Left to right', icon: 'right' },
  { value: 'BT', label: 'Bottom to top', icon: 'up' },
  { value: 'RL', label: 'Right to left', icon: 'left' },
];

// The group picker's "no group" value.
const TOP = '';

const sameScope = (a: StateScope, b: StateScope) => a.parent === b.parent && a.region === b.region;

// Rich-field markdown, normalised so that a field nobody touched hands
// back exactly its value (and so commits nothing).
const normalized = (md: string) => serializeRich(parseRich(md));
const plain = (md: string) => richToPlain(parseRich(md));

export class StateController implements DiagramController {
  private host: DiagramHost;
  // Latest successfully-parsed model; null in fallback mode (edit
  // handlers no-op then).
  private model: StateModel | null = null;
  private source = '';
  private selected: Selection = null;
  // See FlowchartController.pendingSelect: add flows know the new item
  // before its SVG exists; rendered() opens it.
  private pendingSelect: StateTarget | null = null;
  // Non-null while picking the other end of a new transition.
  private connectMode: { from: StateEndpoint } | null = null;
  private form: MountedUi<FormPopoverState>;
  private banner: MountedUi<BannerState>;
  private directionPicker: MountedUi<DirectionPickerState>;
  private actions: MountedUi<ActionsBarState>;

  constructor(host: DiagramHost) {
    this.host = host;
    this.form = mountUi(host, MermaidFormPopover, 'mermaid-popover-host mermaid-form-popover-host', HIDDEN_FORM);
    this.banner = mountUi(host, MermaidConnectBanner, 'mermaid-popover-host mermaid-connect-banner-host', HIDDEN_BANNER);
    this.directionPicker = mountUi(host, MermaidDirectionPicker, 'mermaid-popover-host mermaid-direction-picker-host', HIDDEN_DIRECTION);
    this.actions = mountUi(host, MermaidActionsBar, 'mermaid-popover-host mermaid-actions-host', HIDDEN_BAR);
  }

  load(source: string): boolean {
    const parsed = parseState(source);
    this.model = parsed.ok ? parsed.model : null;
    this.source = source;
    return parsed.ok;
  }

  // A fresh `stateDiagram-v2` has nothing to click: offer a first state.
  emptyState(): EmptyState | null {
    if (!this.model || this.model.states.size > 0 || this.model.transitions.length > 0) return null;
    return { label: '+ Add first state', onActivate: () => this.addState() };
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
    this.refreshToolbars();
  }

  cleared(): void {
    this.pendingSelect = null;
    this.clearSelection();
    this.directionPicker.hide();
    this.actions.hide();
  }

  click(target: Element): boolean {
    const hit = this.hitTest(target);
    // Connect mode: the click picks the other end, or cancels. Checked
    // BEFORE selection so clicking a state connects instead of opening it.
    if (this.connectMode) {
      const from = this.connectMode.from;
      this.exitConnectMode();
      if (hit?.kind === 'state' || hit?.kind === 'composite') {
        if (!(from.kind === 'state' && from.id === hit.id)) this.connect(from, { kind: 'state', id: hit.id });
      } else if (hit?.kind === 'end') {
        this.connect(from, { kind: 'end', scope: hit.scope });
      } else if (hit?.kind === 'start' && from.kind === 'state') {
        // A start circle can only be where an arrow comes FROM.
        this.connect({ kind: 'start', scope: hit.scope }, from);
      }
      return true;
    }
    if (hit) {
      this.select(hit);
      return true;
    }
    this.clearSelection();
    return false;
  }

  destroy(): void {
    this.exitConnectMode();
    this.form.destroy();
    this.banner.destroy();
    this.directionPicker.destroy();
    this.actions.destroy();
  }

  // ── hit testing ────────────────────────────────────────────────────

  private svg(): SVGSVGElement | null {
    return this.host.renderedEl.querySelector('svg');
  }

  private hitTest(target: Element): StateTarget | null {
    const svg = target.closest('svg') as SVGSVGElement | null;
    if (!this.model || !svg) return null;
    return stateTargetAt(target, svg, this.model);
  }

  // The element drawn for an item (highlight / popover anchor). For a
  // transition the visible path, not its wider hit twin.
  private elementFor(t: StateTarget): Element | null {
    const svg = this.svg();
    if (!svg || !this.model) return null;
    if (t.kind === 'transition') {
      const id = this.model.render.transitions[t.index];
      return id ? svg.querySelector(`path.transition[data-id="${CSS.escape(id)}"]`) : null;
    }
    return stateElementFor(svg, this.model, t);
  }

  // ── selection ──────────────────────────────────────────────────────

  private exists(sel: Exclude<Selection, null>): boolean {
    const m = this.model;
    if (!m) return false;
    switch (sel.kind) {
      case 'state':
        return !!m.states.get(sel.id) && !m.states.get(sel.id)!.composite;
      case 'composite':
        return !!m.states.get(sel.id)?.composite;
      case 'transition':
        return sel.index < m.transitions.length;
      case 'note':
        return sel.index < m.notes.length;
      case 'start':
      case 'end':
        return m.terminals.some((t) => t.kind === sel.kind && sameScope(t.scope, sel.scope));
      default:
        return true;
    }
  }

  private select(sel: Exclude<Selection, null>): void {
    this.selected = sel;
    this.host.dom.classList.add('mermaid-has-selection');
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    this.form.hide();
    if (sel.kind === 'title') {
      this.openTitlePopover();
      return;
    }
    const el = this.elementFor(sel);
    el?.classList.add('mermaid-selected');
    if (sel.kind === 'state') this.openStatePopover(sel.id, el);
    else if (sel.kind === 'composite') this.openGroupPopover(sel.id, el);
    else if (sel.kind === 'transition') this.openTransitionPopover(sel.index, el);
    else if (sel.kind === 'note') this.openNotePopover(sel.index, el);
    else this.openTerminalPopover(sel, el);
  }

  private clearSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    this.form.hide();
  }

  // Deletes make the selection stale — drop it BEFORE committing so the
  // re-render (synchronous on a cache hit) doesn't select whatever
  // moves into that place.
  private dropSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.form.hide();
  }

  private show(state: Omit<FormPopoverState, 'visible' | 'onClose'>): void {
    this.form.show({ ...state, visible: true, onClose: () => this.form.hide() });
  }

  // ── names, in plain words ──────────────────────────────────────────

  private nameOf(id: string): string {
    const s = this.model?.states.get(id);
    if (!s) return id;
    if (s.kind === 'fork') return 'Fork';
    if (s.kind === 'join') return 'Join';
    if (s.kind === 'choice') return 'Choice';
    return plain(s.label).trim() || 'Untitled state';
  }

  private endpointName(e: StateEndpoint): string {
    if (e.kind === 'state') return this.nameOf(e.id);
    const where = e.scope.parent ? ` of ${this.nameOf(e.scope.parent)}` : '';
    return (e.kind === 'start' ? 'Start' : 'End') + where;
  }

  // ── popovers ───────────────────────────────────────────────────────

  // "Put in a group": the groups this state can move into (not itself
  // or anything inside it), "No group" and "New group…". Every option
  // is one the engine accepts (dry run), so none of them does nothing.
  private groupField(id: string): FormField {
    const m = this.model!;
    const s = m.states.get(id)!;
    const options: ChoiceOption[] = [{ value: TOP, label: 'No group' }];
    for (const g of m.states.values()) {
      if (!g.composite || g.id === id) continue;
      if (g.id !== s.parent && !this.dryRun({ kind: 'moveState', id, into: g.id })) continue;
      options.push({ value: g.id, label: this.nameOf(g.id) });
    }
    options.push({ value: NEW_GROUP, label: 'New group…' });
    return {
      kind: 'choice',
      id: 'group',
      label: 'Group',
      display: 'select',
      value: s.parent ?? TOP,
      options,
      onChange: (value) => {
        if (value === NEW_GROUP) {
          // The new group's popover opens so it can be named right away.
          this.commit({ kind: 'wrapInComposite', id, label: 'Group' }, (r) => {
            if (r.id) this.pendingSelect = { kind: 'composite', id: r.id };
          });
        } else if (value !== (s.parent ?? TOP)) {
          this.commit({ kind: 'moveState', id, into: value === TOP ? null : value });
        }
      },
    };
  }

  private hasArrow(id: string, kind: 'start' | 'end'): boolean {
    return !!this.model?.transitions.some((t) =>
      kind === 'start' ? t.from.kind === 'start' && t.to.kind === 'state' && t.to.id === id : t.to.kind === 'end' && t.from.kind === 'state' && t.from.id === id,
    );
  }

  // Actions shared by states and groups.
  private stateActions(id: string): FormAction[] {
    const actions: FormAction[] = [{ id: 'connect', label: 'Connect to…', icon: 'link', onClick: () => this.enterConnectMode({ kind: 'state', id }) }];
    if (!this.hasArrow(id, 'start')) actions.push({ id: 'add-start', label: 'Add start arrow', icon: 'flag', onClick: () => this.commit({ kind: 'addStart', id }) });
    if (!this.hasArrow(id, 'end')) actions.push({ id: 'add-end', label: 'Add end arrow', icon: 'check', onClick: () => this.commit({ kind: 'addEnd', id }) });
    actions.push({
      id: 'add-note',
      label: 'Add note',
      icon: 'note',
      onClick: () =>
        this.commit({ kind: 'addNote', state: id, position: 'right', text: 'Note' }, (r) => {
          if (r.index !== undefined) this.pendingSelect = { kind: 'note', index: r.index };
        }),
    });
    return actions;
  }

  private openStatePopover(id: string, svgEl: Element | null): void {
    const s = this.model?.states.get(id);
    if (!s) return;
    const { x, y } = this.host.anchor(svgEl, 'right');
    const fields: FormField[] = [];
    if (s.kind === 'normal') {
      fields.push({
        kind: 'rich',
        id: 'name',
        label: 'Name',
        value: normalized(stateTextMarkdown(this.source, { kind: 'state', id })),
        placeholder: 'Name of the state',
        className: 'mermaid-state-name',
        onCommit: (md) => this.commit({ kind: 'setStateLabel', id, label: md, markdown: true }),
      });
    } else {
      fields.push({ kind: 'hint', id: 'name-hint', text: `A ${this.nameOf(id).toLowerCase()} has no name.` });
    }
    // Only kinds the engine can actually switch to (a state with a name
    // always draws as a box, for instance).
    const kinds = KINDS.filter((k) => k.value === s.kind || this.dryRun({ kind: 'setStateKind', id, stateKind: k.value as StateKind }));
    if (kinds.length > 1) {
      fields.push({
        kind: 'choice',
        id: 'kind',
        label: 'Kind',
        value: s.kind,
        options: kinds,
        onChange: (value) => {
          if (value !== s.kind) this.commit({ kind: 'setStateKind', id, stateKind: value as StateKind });
        },
      });
    }
    fields.push(this.groupField(id));
    this.show({
      x,
      y,
      key: `state:${id}`,
      title: 'State',
      fields,
      actions: [
        ...this.stateActions(id),
        {
          id: 'delete',
          label: 'Delete',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteState', id });
          },
        },
      ],
    });
  }

  private openGroupPopover(id: string, svgEl: Element | null): void {
    const g = this.model?.states.get(id);
    if (!g?.composite) return;
    // Anchored at the group's title so it doesn't cover what's inside.
    const label = svgEl?.querySelector('.cluster-label') ?? svgEl;
    const { x, y } = this.host.anchor(label, 'right');
    const fields: FormField[] = [
      {
        kind: 'rich',
        id: 'name',
        label: 'Name',
        value: normalized(stateTextMarkdown(this.source, { kind: 'state', id })),
        placeholder: 'Name of the group',
        className: 'mermaid-group-title',
        onCommit: (md) => this.commit({ kind: 'setStateLabel', id, label: md, markdown: true }),
      },
    ];
    // mermaid ignores a direction inside a group with parallel regions.
    if (g.composite.regions === 1) {
      fields.push({
        kind: 'choice',
        id: 'direction',
        label: 'Layout',
        value: g.composite.direction,
        options: DIRECTIONS,
        onChange: (value) => this.commit({ kind: 'setCompositeDirection', id, direction: value as StateDirection }),
      });
    }
    fields.push(this.groupField(id));
    this.show({
      x,
      y,
      key: `group:${id}`,
      title: 'Group',
      fields,
      actions: [
        {
          id: 'add-state',
          label: 'Add state inside',
          icon: 'plus',
          onClick: () =>
            this.commit({ kind: 'addState', label: '', parent: id }, (r) => {
              if (r.id) this.pendingSelect = { kind: 'state', id: r.id };
            }),
        },
        ...this.stateActions(id),
        {
          id: 'ungroup',
          label: 'Remove group (keep what’s inside)',
          icon: 'ungroup',
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'ungroup', id });
          },
        },
        {
          id: 'delete-group',
          label: 'Delete group and everything in it',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteState', id });
          },
        },
      ],
    });
  }

  private openTransitionPopover(index: number, svgEl: Element | null): void {
    const t = this.model?.transitions[index];
    if (!t) return;
    const { x, y } = this.host.anchor(svgEl, 'center');
    this.show({
      x,
      y,
      key: `transition:${index}`,
      title: 'Transition',
      fields: [
        { kind: 'hint', id: 'ends', text: `From ${this.endpointName(t.from)} to ${this.endpointName(t.to)}` },
        {
          kind: 'rich',
          id: 'label',
          label: 'Label',
          value: normalized(stateTextMarkdown(this.source, { kind: 'transition', index })),
          placeholder: 'What makes it happen',
          className: 'mermaid-transition-label',
          onCommit: (md) => this.commit({ kind: 'setTransitionLabel', index, label: md, markdown: true }),
        },
      ],
      actions: [
        {
          id: 'delete',
          label: 'Delete',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteTransition', index });
          },
        },
      ],
    });
  }

  private openNotePopover(index: number, svgEl: Element | null): void {
    const n = this.model?.notes[index];
    if (!n) return;
    const { x, y } = this.host.anchor(svgEl, 'right');
    this.show({
      x,
      y,
      key: `note:${index}`,
      title: 'Note',
      fields: [
        { kind: 'hint', id: 'about', text: `About ${this.nameOf(n.state)}` },
        {
          kind: 'rich',
          id: 'text',
          label: 'Text',
          value: normalized(stateTextMarkdown(this.source, { kind: 'note', index })),
          multiline: true,
          placeholder: 'Note text',
          className: 'mermaid-note-text',
          // An emptied note is refused by the engine: delete it instead.
          onCommit: (md) => this.commit({ kind: 'setNoteText', index, text: md, markdown: true }),
        },
        {
          kind: 'choice',
          id: 'side',
          label: 'Side',
          value: n.position,
          options: [
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ],
          onChange: (value) => {
            if (value !== n.position) this.commit({ kind: 'setNotePosition', index, position: value as 'left' | 'right' });
          },
        },
      ],
      actions: [
        {
          id: 'delete',
          label: 'Delete',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteNote', index });
          },
        },
      ],
    });
  }

  private openTerminalPopover(t: { kind: 'start' | 'end'; scope: StateScope }, svgEl: Element | null): void {
    const { x, y } = this.host.anchor(svgEl, 'right');
    const name = this.endpointName(t);
    this.show({
      x,
      y,
      key: `${t.kind}:${t.scope.parent ?? ''}:${t.scope.region}`,
      title: name,
      fields: [
        {
          kind: 'hint',
          id: 'about',
          text: t.kind === 'start' ? 'Where things begin. Its arrows point to the first state.' : 'Where things finish. Arrows from the last states point here.',
        },
      ],
      actions: [
        {
          id: 'delete',
          label: t.kind === 'start' ? 'Delete start and its arrows' : 'Delete end and its arrows',
          icon: 'trash',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'deleteTerminal', terminal: t });
          },
        },
      ],
    });
  }

  private diagramTitle(): string {
    return findPreamble(this.source.split(/\r?\n/)).frontmatter?.title?.value ?? '';
  }

  private openTitlePopover(): void {
    const bar = this.host.dom.querySelector('.mermaid-actions-bar [data-action="title"]');
    const { x, y } = this.host.anchor(bar, 'right');
    this.form.show({
      visible: true,
      x,
      y,
      key: 'title',
      title: 'Diagram title',
      fields: [
        {
          kind: 'text',
          id: 'title',
          value: this.diagramTitle(),
          placeholder: 'Title shown above the diagram',
          className: 'mermaid-title-input',
          onCommit: (title) => {
            const source = this.host.source();
            if (source != null) this.host.commit(setFrontmatterTitle(source, title));
          },
        },
      ],
      actions: [],
      onClose: () => {
        if (this.selected?.kind === 'title') this.selected = null;
        this.form.hide();
      },
    });
  }

  private refreshToolbars(): void {
    const m = this.model;
    if (!m || (m.states.size === 0 && m.transitions.length === 0)) {
      this.directionPicker.hide();
      this.actions.hide();
      return;
    }
    this.directionPicker.show({
      visible: true,
      direction: toPicker(m.direction),
      onDirectionChange: (direction) => this.commit({ kind: 'setDirection', direction: fromPicker(direction) }),
    });
    this.actions.show({
      visible: true,
      ariaLabel: 'State diagram actions',
      align: 'left',
      items: [
        { id: 'add-state', label: 'State', icon: 'plus', onClick: () => this.addState() },
        { id: 'title', label: this.diagramTitle() ? 'Title' : 'Add title', icon: 'text', onClick: () => this.select({ kind: 'title' }) },
      ],
    });
  }

  // ── edits ──────────────────────────────────────────────────────────

  // `beforeCommit` runs with the edit's result before the transaction
  // is dispatched (see FlowchartController.commit).
  private commit(edit: StateEdit, beforeCommit?: (result: StateEditResult) => void): void {
    if (!this.model) return;
    const source = this.host.source();
    if (source == null) return;
    const result = applyStateEdit(source, edit);
    if (!result || result.source === source) return;
    beforeCommit?.(result);
    this.host.commit(result.source);
  }

  // Would `edit` do something? (Offer only options that work.)
  private dryRun(edit: StateEdit): boolean {
    const r = applyStateEdit(this.source, edit);
    return !!r && r.source !== this.source;
  }

  // A fresh, unnamed state, its popover open so it can be named.
  private addState(): void {
    this.commit({ kind: 'addState', label: '' }, (r) => {
      if (r.id) this.pendingSelect = { kind: 'state', id: r.id };
    });
  }

  private connect(from: StateEndpoint, to: StateEndpoint): void {
    this.commit({ kind: 'addTransition', from, to }, (r) => {
      if (r.index !== undefined) this.pendingSelect = { kind: 'transition', index: r.index };
    });
  }

  // ── connect mode ───────────────────────────────────────────────────

  private enterConnectMode(from: StateEndpoint): void {
    this.connectMode = { from };
    this.host.dom.classList.add('mermaid-connect-mode');
    this.form.hide();
    this.banner.show({
      visible: true,
      hint: 'Click a state, a start or an end to connect to',
      addLabel: 'Add new state',
      onAddNewNode: () => this.addNewStateInConnectMode(),
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

  // State + transition in ONE edit (one transaction, one render); the
  // new state's popover opens once its SVG exists. From a group, the new
  // state goes inside it.
  private addNewStateInConnectMode(): void {
    if (!this.connectMode || !this.model) return;
    const from = this.connectMode.from;
    this.exitConnectMode();
    if (from.kind !== 'state') return;
    const s = this.model.states.get(from.id);
    const edit: StateEdit = s?.composite
      ? { kind: 'addState', label: '', parent: from.id }
      : { kind: 'addState', label: '', parent: s?.parent ?? null, connectFrom: from };
    this.commit(edit, (r) => {
      if (r.id) this.pendingSelect = { kind: 'state', id: r.id };
    });
  }

  // mermaid's transitions are 1-2px paths; give each a wider transparent
  // twin (same data-id, so state-svg.ts maps it the same), inserted
  // BEFORE the visible path so that one still paints on top.
  private injectEdgeHitTargets(): void {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    this.host.renderedEl.querySelectorAll('path.transition[data-id]').forEach((path) => {
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
