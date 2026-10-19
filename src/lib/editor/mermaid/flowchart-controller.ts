// Flowchart editing (see controller.ts for the contract). Click selects
// a node, a connection or a group and opens its popover; popover edits
// become source-preserving text changes (mermaid-flowchart-edit.ts)
// committed through the node view, whose re-render brings the new SVG
// back here.
import MermaidNodePopover from '../../../components/MermaidNodePopover.svelte';
import MermaidEdgePopover from '../../../components/MermaidEdgePopover.svelte';
import MermaidConnectBanner from '../../../components/MermaidConnectBanner.svelte';
import MermaidDirectionPicker from '../../../components/MermaidDirectionPicker.svelte';
import MermaidFormPopover from '../../../components/MermaidFormPopover.svelte';
import MermaidActionsBar from '../../../components/MermaidActionsBar.svelte';
import { parseMermaid } from '../mermaid-parser';
import {
  edgeDataIds,
  styleValue,
  type EdgeEnds,
  type EdgeStroke,
  type MermaidDirection,
  type MermaidGraph,
  type MermaidShape,
} from '../mermaid-graph';
import {
  applyFlowchartEdit,
  type ClassicShape,
  type FlowchartEdit,
  type FlowchartEditResult,
  type NodeColorProp,
} from '../mermaid-flowchart-edit';
import { findPreamble, setFrontmatterTitle } from './source-text';
import { serializeRich, parseRich, hasFormatting, richToPlain } from './rich-text';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';
import {
  HIDDEN_BAR,
  HIDDEN_FORM,
  NEW_GROUP,
  type ActionsBarState,
  type FormPopoverState,
} from './form';

// Edges are identified by their INDEX in graph.edges, not a (from,to)
// pair — parallel edges share endpoints, and the index is what the
// edit engine keys on anyway.
type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; index: number }
  | { kind: 'group'; id: string }
  | { kind: 'title' }
  | null;

interface NodePopoverState {
  visible: boolean;
  x: number;
  y: number;
  label: string;
  markdown?: boolean;
  shape: MermaidShape;
  groups?: Array<{ id: string; title: string }>;
  group?: string | null;
  colors?: Partial<Record<NodeColorProp, string | null>>;
  onLabelChange: (label: string, markdown: boolean) => void;
  onShapeChange: (shape: MermaidShape) => void;
  onGroupChange?: (group: string | null) => void;
  onColorChange?: (prop: NodeColorProp, value: string | null) => void;
  onDelete: () => void;
  onAddConnection: () => void;
  onClose: () => void;
}

const HIDDEN_NODE: NodePopoverState = {
  visible: false,
  x: 0,
  y: 0,
  label: '',
  shape: 'rect',
  onLabelChange: () => {},
  onShapeChange: () => {},
  onDelete: () => {},
  onAddConnection: () => {},
  onClose: () => {},
};

interface EdgePopoverState {
  visible: boolean;
  x: number;
  y: number;
  label: string;
  markdown?: boolean;
  stroke: EdgeStroke;
  ends: EdgeEnds;
  color?: string | null;
  onLabelChange: (label: string, markdown: boolean) => void;
  onStrokeChange: (stroke: EdgeStroke) => void;
  onEndsChange: (ends: EdgeEnds) => void;
  onColorChange?: (value: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}

const HIDDEN_EDGE: EdgePopoverState = {
  visible: false,
  x: 0,
  y: 0,
  label: '',
  stroke: 'solid',
  ends: 'arrow',
  onLabelChange: () => {},
  onStrokeChange: () => {},
  onEndsChange: () => {},
  onDelete: () => {},
  onClose: () => {},
};

export interface BannerState {
  visible: boolean;
  hint?: string;
  addLabel?: string | null;
  onAddNewNode: () => void;
  onCancel: () => void;
}

export const HIDDEN_BANNER: BannerState = {
  visible: false,
  onAddNewNode: () => {},
  onCancel: () => {},
};

interface DirectionPickerState {
  visible: boolean;
  direction: MermaidDirection;
  onDirectionChange: (direction: MermaidDirection) => void;
}

const HIDDEN_DIRECTION: DirectionPickerState = {
  visible: false,
  direction: 'TD',
  onDirectionChange: () => {},
};

const NODE_SELECTOR = 'g.node[id*="-flowchart-"], g.node[id^="flowchart-"]';
// `<svgId>-flowchart-<nodeId>-<n>` (mermaid 11); node ids may contain
// `-`, so the id is everything between the marker and the counter.
const NODE_ID_RE = /(?:^|-)flowchart-(.+)-\d+$/;

// A markdown-string label edits as markdown; a plain one is escaped so
// the rich field shows it as typed.
function richValue(label: string, markdown: boolean | undefined): string {
  return markdown ? label : serializeRich([{ text: label, bold: false, italic: false }]);
}

export class FlowchartController implements DiagramController {
  private host: DiagramHost;
  // Latest successfully-parsed graph. null when the source doesn't
  // parse (fallback mode); edit handlers no-op then.
  private graph: MermaidGraph | null = null;
  private source = '';
  private selected: Selection = null;
  // Selection to apply once the in-flight render completes. Add flows
  // know the new item's id before its SVG exists; rendered() consumes
  // it so the popover anchors against a real element.
  private pendingSelect: { kind: 'node' | 'group'; id: string } | null = null;
  // Non-null while the user is picking a target for a new edge.
  private connectMode: { sourceId: string } | null = null;
  private nodePopover: MountedUi<NodePopoverState>;
  private edgePopover: MountedUi<EdgePopoverState>;
  private form: MountedUi<FormPopoverState>;
  private banner: MountedUi<BannerState>;
  private directionPicker: MountedUi<DirectionPickerState>;
  private actions: MountedUi<ActionsBarState>;

  constructor(host: DiagramHost) {
    this.host = host;
    this.nodePopover = mountUi(host, MermaidNodePopover, 'mermaid-popover-host', HIDDEN_NODE);
    this.edgePopover = mountUi(host, MermaidEdgePopover, 'mermaid-popover-host mermaid-edge-popover-host', HIDDEN_EDGE);
    this.form = mountUi(host, MermaidFormPopover, 'mermaid-popover-host mermaid-form-popover-host', HIDDEN_FORM);
    this.banner = mountUi(host, MermaidConnectBanner, 'mermaid-popover-host mermaid-connect-banner-host', HIDDEN_BANNER);
    this.directionPicker = mountUi(
      host,
      MermaidDirectionPicker,
      'mermaid-popover-host mermaid-direction-picker-host',
      HIDDEN_DIRECTION,
    );
    this.actions = mountUi(host, MermaidActionsBar, 'mermaid-popover-host mermaid-actions-host', HIDDEN_BAR);
  }

  load(source: string): boolean {
    const parsed = parseMermaid(source);
    this.graph = parsed.ok ? parsed.graph : null;
    this.source = source;
    return parsed.ok;
  }

  // Empty diagram (e.g. a fresh `flowchart TD` from the toolbar): there
  // is nothing to click, so offer a "+ Add first shape" entry point.
  emptyState(): EmptyState | null {
    if (!this.graph || this.graph.nodes.size > 0 || this.graph.subgraphs.size > 0) return null;
    return { label: '+ Add first shape', onActivate: () => this.addNode() };
  }

  rendered(): void {
    this.injectEdgeHitTargets();
    // A pending select (from an add flow) takes precedence over
    // restoring the previous selection — the user just created this
    // item and expects its popover. A stale one (missing, e.g. an undo
    // landed in between) falls through to the restore below.
    const pending = this.pendingSelect;
    this.pendingSelect = null;
    if (pending && this.exists(pending)) {
      this.select(pending);
    } else if (this.selected) {
      // The re-rendered SVG has fresh elements: re-apply the highlight
      // and re-anchor the popover, or drop a selection that went.
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
    // Connect mode: clicks pick a target for a new edge, or cancel.
    // Checked BEFORE normal selection so clicking an existing node adds
    // an edge instead of selecting it. A group is a valid target too.
    if (this.connectMode) {
      const to = hit?.kind === 'node' || hit?.kind === 'group' ? hit.id : null;
      // A self-loop click adds nothing but still leaves connect mode —
      // less surprising than staying in it.
      if (to && to !== this.connectMode.sourceId) {
        this.commit({ kind: 'addEdge', from: this.connectMode.sourceId, to });
      }
      this.exitConnectMode();
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
    this.nodePopover.destroy();
    this.edgePopover.destroy();
    this.form.destroy();
    this.banner.destroy();
    this.directionPicker.destroy();
    this.actions.destroy();
  }

  // ── hit testing ────────────────────────────────────────────────────

  private svgId(el: Element): string {
    return el.closest('svg')?.id ?? '';
  }

  private hitTest(target: Element): Exclude<Selection, null | { kind: 'title' }> | null {
    if (!this.graph) return null;
    const nodeEl = target.closest(NODE_SELECTOR);
    if (nodeEl) {
      const m = NODE_ID_RE.exec(nodeEl.id);
      if (m && this.graph.nodes.has(m[1])) return { kind: 'node', id: m[1] };
    }
    // Edges: mermaid 11 gives both the path and the label group a
    // data-id (`L_${from}_${to}_${counter}`, or the source's own edge
    // id); a click on label text lands in a <span> inside the label's
    // foreignObject, a sibling of the path. Resolve it to an edge INDEX
    // by exact lookup against the ids mermaid assigned (edgeDataIds) —
    // parsing the flat string is ambiguous for underscore node ids, and
    // the counter is what tells parallel edges apart.
    const edgeEl = target.closest('path.flowchart-link[data-id], path.mermaid-edge-hit[data-id], g.edgeLabel [data-id]');
    if (edgeEl) {
      const index = edgeDataIds(this.graph).indexOf(edgeEl.getAttribute('data-id') ?? '');
      if (index !== -1) return { kind: 'edge', index };
    }
    // Groups: `g.cluster#<svgId>-<groupId>`.
    const clusterEl = target.closest('g.cluster');
    if (clusterEl) {
      const prefix = `${this.svgId(clusterEl)}-`;
      const id = clusterEl.id.startsWith(prefix) ? clusterEl.id.slice(prefix.length) : clusterEl.id;
      if (this.graph.subgraphs.has(id)) return { kind: 'group', id };
    }
    return null;
  }

  private nodeElement(id: string): Element | null {
    for (const el of Array.from(this.host.renderedEl.querySelectorAll(NODE_SELECTOR))) {
      if (NODE_ID_RE.exec(el.id)?.[1] === id) return el;
    }
    return null;
  }

  private groupElement(id: string): Element | null {
    for (const el of Array.from(this.host.renderedEl.querySelectorAll('g.cluster'))) {
      if (el.id === `${this.svgId(el)}-${id}`) return el;
    }
    return null;
  }

  // ── selection ──────────────────────────────────────────────────────

  private exists(sel: Exclude<Selection, null>): boolean {
    if (!this.graph) return false;
    if (sel.kind === 'node') return this.graph.nodes.has(sel.id);
    if (sel.kind === 'group') return this.graph.subgraphs.has(sel.id);
    if (sel.kind === 'edge') return sel.index < this.graph.edges.length;
    return true;
  }

  private select(sel: Exclude<Selection, null>): void {
    this.selected = sel;
    this.host.dom.classList.add('mermaid-has-selection');
    const rendered = this.host.renderedEl;
    rendered.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    this.nodePopover.hide();
    this.edgePopover.hide();
    this.form.hide();
    if (sel.kind === 'node') {
      const el = this.nodeElement(sel.id);
      el?.classList.add('mermaid-selected');
      this.openNodePopover(sel.id, el);
    } else if (sel.kind === 'edge') {
      // Exact data-id lookup, so the highlight lands on the clicked
      // edge and not on its first parallel sibling.
      const dataId = this.graph ? edgeDataIds(this.graph)[sel.index] : undefined;
      const el = dataId ? rendered.querySelector(`path.flowchart-link[data-id="${CSS.escape(dataId)}"]`) : null;
      el?.classList.add('mermaid-selected');
      this.openEdgePopover(sel.index, el);
    } else if (sel.kind === 'group') {
      const el = this.groupElement(sel.id);
      el?.classList.add('mermaid-selected');
      this.openGroupPopover(sel.id, el);
    } else {
      this.openTitlePopover();
    }
  }

  private clearSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.host.renderedEl
      .querySelectorAll('.mermaid-selected')
      .forEach((el) => el.classList.remove('mermaid-selected'));
    this.nodePopover.hide();
    this.edgePopover.hide();
    this.form.hide();
  }

  // Deletes make the selection stale — drop it BEFORE committing so the
  // re-render (synchronous on a cache hit) doesn't select whatever
  // moves into that place.
  private dropSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.nodePopover.hide();
    this.edgePopover.hide();
    this.form.hide();
  }

  // ── popovers ───────────────────────────────────────────────────────

  private groupChoices(): Array<{ id: string; title: string }> {
    return this.graph ? [...this.graph.subgraphs.values()].map((s) => ({ id: s.id, title: s.title })) : [];
  }

  private openNodePopover(id: string, svgEl: Element | null): void {
    const graph = this.graph;
    const node = graph?.nodes.get(id);
    if (!graph || !node) return;
    const { x, y } = this.host.anchor(svgEl, 'right');
    const styles = graph.nodeStyles.get(id);
    this.nodePopover.show({
      visible: true,
      x,
      y,
      label: node.label,
      markdown: node.markdown,
      shape: node.shape,
      groups: this.groupChoices(),
      group: graph.groupOf.get(id) ?? null,
      colors: { fill: styleValue(styles, 'fill'), stroke: styleValue(styles, 'stroke'), color: styleValue(styles, 'color') },
      onLabelChange: (label, markdown) => this.commit({ kind: 'setNodeLabel', id, label, markdown }),
      onShapeChange: (shape) => {
        if (shape !== 'other') this.commit({ kind: 'setNodeShape', id, shape: shape as ClassicShape });
      },
      onGroupChange: (group) => {
        if (group === NEW_GROUP) {
          // The new group's popover opens so it can be named right away.
          this.commit({ kind: 'addGroup', title: 'Group', members: [id] }, (r) => {
            if (r.id) this.pendingSelect = { kind: 'group', id: r.id };
          });
        } else {
          this.commit({ kind: 'setNodeGroup', id, group });
        }
      },
      onColorChange: (prop, value) => this.commit({ kind: 'setNodeColor', id, prop, value }),
      onDelete: () => {
        this.dropSelection();
        this.commit({ kind: 'deleteNode', id });
      },
      onAddConnection: () => this.enterConnectMode(id),
      onClose: () => this.nodePopover.hide(),
    });
  }

  private openEdgePopover(index: number, svgEl: Element | null): void {
    const graph = this.graph;
    const edge = graph?.edges[index];
    if (!graph || !edge || !svgEl) return;
    const { x, y } = this.host.anchor(svgEl, 'center');
    this.edgePopover.show({
      visible: true,
      x,
      y,
      label: edge.label ?? '',
      markdown: edge.markdown,
      stroke: edge.stroke ?? 'solid',
      ends: edge.ends ?? 'arrow',
      color: styleValue(graph.edgeStyles.get(index), 'stroke'),
      onLabelChange: (label, markdown) => this.commit({ kind: 'setEdgeLabel', index, label, markdown }),
      onStrokeChange: (stroke) => this.commit({ kind: 'setEdgeStroke', index, stroke }),
      onEndsChange: (ends) => this.commit({ kind: 'setEdgeEnds', index, ends }),
      onColorChange: (value) => this.commit({ kind: 'setEdgeColor', index, prop: 'stroke', value }),
      onDelete: () => {
        this.dropSelection();
        this.commit({ kind: 'deleteEdge', index });
      },
      onClose: () => this.edgePopover.hide(),
    });
  }

  private openGroupPopover(id: string, svgEl: Element | null): void {
    const sg = this.graph?.subgraphs.get(id);
    if (!sg) return;
    // Anchored at the group's title, top left, so it doesn't cover the
    // shapes inside.
    const label = svgEl?.querySelector('.cluster-label') ?? svgEl;
    const { x, y } = this.host.anchor(label, 'right');
    this.form.show({
      visible: true,
      x,
      y,
      key: `group:${id}`,
      title: 'Group',
      fields: [
        {
          kind: 'rich',
          id: 'title',
          label: 'Name',
          value: richValue(sg.title, sg.markdown),
          className: 'mermaid-group-title',
          onCommit: (md) => this.commitRich(md, (title, markdown) => ({ kind: 'setGroupTitle', id, title, markdown })),
        },
      ],
      actions: [
        {
          id: 'add-shape',
          label: 'Add shape inside',
          icon: 'plus',
          onClick: () =>
            this.commit({ kind: 'addNode', shape: 'rect', label: '', group: id }, (r) => {
              if (r.id) this.pendingSelect = { kind: 'node', id: r.id };
            }),
        },
        {
          id: 'connect',
          label: 'Connect',
          icon: 'link',
          onClick: () => this.enterConnectMode(id),
        },
        {
          id: 'ungroup',
          label: 'Remove group (keep what’s inside)',
          icon: 'ungroup',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'ungroup', id });
          },
        },
      ],
      onClose: () => this.form.hide(),
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
    const graph = this.graph;
    if (!graph || (graph.nodes.size === 0 && graph.subgraphs.size === 0)) {
      this.directionPicker.hide();
      this.actions.hide();
      return;
    }
    this.directionPicker.show({
      visible: true,
      direction: graph.direction,
      onDirectionChange: (direction) => this.commit({ kind: 'setDirection', direction }),
    });
    this.actions.show({
      visible: true,
      ariaLabel: 'Flowchart actions',
      align: 'left',
      items: [
        { id: 'add-shape', label: 'Shape', icon: 'plus', onClick: () => this.addNode() },
        { id: 'title', label: this.diagramTitle() ? 'Title' : 'Add title', icon: 'text', onClick: () => this.select({ kind: 'title' }) },
      ],
    });
  }

  // ── edits ──────────────────────────────────────────────────────────

  // `beforeCommit` runs with the edit's result before the transaction
  // is dispatched; add flows use it to stash pendingSelect for the new
  // id (the render the commit triggers may complete synchronously on a
  // cache hit, so it has to be set first).
  private commit(edit: FlowchartEdit, beforeCommit?: (result: FlowchartEditResult) => void): void {
    if (!this.graph) return;
    const source = this.host.source();
    if (source == null) return;
    const result = applyFlowchartEdit(source, edit);
    if (!result) return;
    beforeCommit?.(result);
    this.host.commit(result.source);
  }

  // A rich field's markdown → plain text, or markdown when it has bold /
  // italic in it.
  private commitRich(md: string, make: (text: string, markdown: boolean) => FlowchartEdit): void {
    const runs = parseRich(md);
    const markdown = hasFormatting(runs);
    this.commit(make(markdown ? md : richToPlain(runs), markdown));
  }

  // A fresh shape, its popover open so it can be named right away.
  private addNode(): void {
    this.commit({ kind: 'addNode', shape: 'rect', label: '' }, (r) => {
      if (r.id) this.pendingSelect = { kind: 'node', id: r.id };
    });
  }

  // ── connect mode ───────────────────────────────────────────────────

  private enterConnectMode(sourceId: string): void {
    this.connectMode = { sourceId };
    this.host.dom.classList.add('mermaid-connect-mode');
    this.nodePopover.hide();
    this.edgePopover.hide();
    this.form.hide();
    this.banner.show({
      visible: true,
      hint: 'Click a shape or group to connect to',
      addLabel: 'Add new shape',
      onAddNewNode: () => this.addNewNodeInConnectMode(),
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

  // Node + edge in ONE edit, so a single transaction (and render) picks
  // up both; the new node's popover opens once its SVG exists.
  private addNewNodeInConnectMode(): void {
    if (!this.connectMode || !this.graph) return;
    const sourceId = this.connectMode.sourceId;
    if (this.graph.subgraphs.has(sourceId)) {
      // From a group: the new shape goes inside it.
      this.commit({ kind: 'addNode', shape: 'rect', label: '', group: sourceId }, (r) => {
        if (r.id) this.pendingSelect = { kind: 'node', id: r.id };
      });
    } else {
      this.commit({ kind: 'addNode', shape: 'rect', label: '', connectFrom: sourceId }, (r) => {
        if (r.id) this.pendingSelect = { kind: 'node', id: r.id };
      });
    }
    this.exitConnectMode();
  }

  // Mermaid's edges are 1-2px paths whose hit area is the visible
  // stroke. Each gets a wider transparent twin (same `d`, same data-id,
  // so the click routing treats it identically), inserted BEFORE the
  // visible path so that one still paints on top.
  private injectEdgeHitTargets(): void {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    this.host.renderedEl.querySelectorAll('path.flowchart-link[data-id]').forEach((path) => {
      const parent = path.parentNode;
      if (!parent) return;
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', path.getAttribute('d') || '');
      // Deliberately NOT `flowchart-link`: that class carries the hover
      // / selection CSS, which on a 14px band paints a chunky ribbon.
      hit.setAttribute('class', 'mermaid-edge-hit');
      hit.setAttribute('data-id', path.getAttribute('data-id') || '');
      hit.setAttribute('stroke-width', '14');
      hit.setAttribute('fill', 'none');
      hit.style.pointerEvents = 'stroke';
      parent.insertBefore(hit, path);
    });
  }
}
