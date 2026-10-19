// Flowchart editing (see controller.ts for the contract). Click selects
// a node / edge and opens its popover; popover edits become source-
// preserving text changes (mermaid-flowchart-edit.ts) committed through
// the node view, whose re-render brings the new SVG back here.
import MermaidNodePopover from '../../../components/MermaidNodePopover.svelte';
import MermaidEdgePopover from '../../../components/MermaidEdgePopover.svelte';
import MermaidConnectBanner from '../../../components/MermaidConnectBanner.svelte';
import MermaidDirectionPicker from '../../../components/MermaidDirectionPicker.svelte';
import { parseMermaid } from '../mermaid-parser';
import {
  edgeDataIds,
  type MermaidGraph,
  type MermaidShape,
  type EdgeStyle,
  type MermaidDirection,
} from '../mermaid-graph';
import {
  applyFlowchartEdit,
  type FlowchartEdit,
  type FlowchartEditResult,
} from '../mermaid-flowchart-edit';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';

// Edges are identified by their INDEX in graph.edges, not a (from,to)
// pair — parallel edges share endpoints, and the index is what the
// edit engine keys on anyway.
type Selection = { kind: 'node'; id: string } | { kind: 'edge'; index: number } | null;

interface NodePopoverState {
  visible: boolean;
  x: number;
  y: number;
  label: string;
  shape: MermaidShape;
  onLabelChange: (label: string) => void;
  onShapeChange: (shape: MermaidShape) => void;
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
  style: EdgeStyle;
  onLabelChange: (label: string) => void;
  onStyleChange: (style: EdgeStyle) => void;
  onDelete: () => void;
  onClose: () => void;
}

const HIDDEN_EDGE: EdgePopoverState = {
  visible: false,
  x: 0,
  y: 0,
  label: '',
  style: 'arrow',
  onLabelChange: () => {},
  onStyleChange: () => {},
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

const NODE_SELECTOR = 'g.node[id*="flowchart-"]';
const NODE_ID_RE = /flowchart-([A-Za-z][A-Za-z0-9_]*)/;

export class FlowchartController implements DiagramController {
  private host: DiagramHost;
  // Latest successfully-parsed graph. null when the source doesn't
  // parse (fallback mode); edit handlers no-op then.
  private graph: MermaidGraph | null = null;
  private selected: Selection = null;
  // Selection to apply once the in-flight render completes. Add flows
  // know the new node's id before its SVG exists; rendered() consumes
  // it so the popover anchors against a real element.
  private pendingSelect: { id: string } | null = null;
  // Non-null while the user is picking a target for a new edge.
  private connectMode: { sourceId: string } | null = null;
  private nodePopover: MountedUi<NodePopoverState>;
  private edgePopover: MountedUi<EdgePopoverState>;
  private banner: MountedUi<BannerState>;
  private directionPicker: MountedUi<DirectionPickerState>;

  constructor(host: DiagramHost) {
    this.host = host;
    this.nodePopover = mountUi(host, MermaidNodePopover, 'mermaid-popover-host', HIDDEN_NODE);
    this.edgePopover = mountUi(host, MermaidEdgePopover, 'mermaid-popover-host mermaid-edge-popover-host', HIDDEN_EDGE);
    this.banner = mountUi(host, MermaidConnectBanner, 'mermaid-popover-host mermaid-connect-banner-host', HIDDEN_BANNER);
    this.directionPicker = mountUi(
      host,
      MermaidDirectionPicker,
      'mermaid-popover-host mermaid-direction-picker-host',
      HIDDEN_DIRECTION,
    );
  }

  load(source: string): boolean {
    const parsed = parseMermaid(source);
    this.graph = parsed.ok ? parsed.graph : null;
    return parsed.ok;
  }

  // Empty diagram (e.g. a fresh `flowchart TD` from the toolbar): there
  // is nothing to click, so offer a "+ Add first shape" entry point.
  emptyState(): EmptyState | null {
    if (!this.graph || this.graph.nodes.size > 0) return null;
    return { label: '+ Add first shape', onActivate: () => this.createFirstNode() };
  }

  rendered(): void {
    this.injectEdgeHitTargets();
    // A pending select (from an add flow) takes precedence over
    // restoring the previous selection — the user just created this
    // node and expects its popover. A stale one (node missing, e.g. an
    // undo landed in between) falls through to the restore below.
    const pending = this.pendingSelect;
    this.pendingSelect = null;
    if (pending && this.graph?.nodes.has(pending.id)) {
      this.selectNode(pending.id);
    } else if (this.selected?.kind === 'node') {
      // The re-rendered SVG has fresh elements: re-apply the highlight
      // and re-anchor the popover, or drop a selection whose node went.
      if (this.graph?.nodes.has(this.selected.id)) this.selectNode(this.selected.id);
      else this.clearSelection();
    } else if (this.selected?.kind === 'edge') {
      if (this.graph && this.selected.index < this.graph.edges.length) this.selectEdge(this.selected.index);
      else this.clearSelection();
    }
    this.refreshDirectionPicker();
  }

  cleared(): void {
    this.pendingSelect = null;
    this.clearSelection();
    this.directionPicker.hide();
  }

  click(target: Element): boolean {
    // Connect mode: clicks pick a target for a new edge, or cancel.
    // Checked BEFORE normal selection so clicking an existing node adds
    // an edge instead of selecting it.
    if (this.connectMode) {
      const nodeEl = target.closest(NODE_SELECTOR);
      const m = nodeEl ? NODE_ID_RE.exec(nodeEl.id) : null;
      // A self-loop click adds nothing but still leaves connect mode —
      // less surprising than staying in it.
      if (m && m[1] !== this.connectMode.sourceId && this.graph) {
        this.commit({ kind: 'addEdge', from: this.connectMode.sourceId, to: m[1] });
      }
      this.exitConnectMode();
      return true;
    }

    const nodeEl = target.closest(NODE_SELECTOR);
    if (nodeEl) {
      const m = NODE_ID_RE.exec(nodeEl.id);
      if (m) {
        this.selectNode(m[1]);
        return true;
      }
    }
    // Edges: mermaid 11 gives both the path and the label group a
    // `data-id="L_${from}_${to}_${counter}"` (a click on label text lands
    // in a <span> inside the label's foreignObject, a sibling of the
    // path). Resolve it to an edge INDEX by exact lookup against the ids
    // mermaid assigned (edgeDataIds) — parsing the flat string is
    // ambiguous for underscore node ids, and the counter is what tells
    // parallel edges apart.
    const edgeEl = target.closest('[data-id^="L_"]');
    if (edgeEl && this.graph) {
      const index = edgeDataIds(this.graph).indexOf(edgeEl.getAttribute('data-id') ?? '');
      if (index !== -1) {
        this.selectEdge(index);
        return true;
      }
    }
    this.clearSelection();
    return false;
  }

  destroy(): void {
    this.exitConnectMode();
    this.nodePopover.destroy();
    this.edgePopover.destroy();
    this.banner.destroy();
    this.directionPicker.destroy();
  }

  // ── selection ──────────────────────────────────────────────────────

  private selectNode(id: string): void {
    this.selected = { kind: 'node', id };
    this.host.dom.classList.add('mermaid-has-selection');
    const rendered = this.host.renderedEl;
    rendered.querySelectorAll('g.node.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
    const svgEl = rendered.querySelector(`g.node[id*="flowchart-${id}-"]`);
    svgEl?.classList.add('mermaid-selected');
    this.edgePopover.hide();
    this.openNodePopover(id, svgEl);
  }

  private selectEdge(index: number): void {
    this.selected = { kind: 'edge', index };
    this.host.dom.classList.add('mermaid-has-selection');
    const rendered = this.host.renderedEl;
    rendered
      .querySelectorAll('path.flowchart-link.mermaid-selected')
      .forEach((el) => el.classList.remove('mermaid-selected'));
    // Exact data-id lookup, so the highlight lands on the clicked edge
    // and not on its first parallel sibling.
    const dataId = this.graph ? edgeDataIds(this.graph)[index] : undefined;
    const svgEl = dataId ? rendered.querySelector(`path.flowchart-link[data-id="${dataId}"]`) : null;
    svgEl?.classList.add('mermaid-selected');
    this.nodePopover.hide();
    this.openEdgePopover(index, svgEl);
  }

  private clearSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.host.renderedEl
      .querySelectorAll('.mermaid-selected')
      .forEach((el) => el.classList.remove('mermaid-selected'));
    this.nodePopover.hide();
    this.edgePopover.hide();
  }

  // ── popovers ───────────────────────────────────────────────────────

  private openNodePopover(id: string, svgEl: Element | null): void {
    const node = this.graph?.nodes.get(id);
    if (!node) {
      this.nodePopover.hide();
      return;
    }
    const { x, y } = this.host.anchor(svgEl, 'right');
    this.nodePopover.show({
      visible: true,
      x,
      y,
      label: node.label,
      shape: node.shape,
      onLabelChange: (label) => this.commit({ kind: 'setNodeLabel', id, label }),
      onShapeChange: (shape) => this.commit({ kind: 'setNodeShape', id, shape }),
      onDelete: () => {
        this.commit({ kind: 'deleteNode', id });
        this.nodePopover.hide();
      },
      onAddConnection: () => this.enterConnectMode(id),
      onClose: () => this.nodePopover.hide(),
    });
  }

  private openEdgePopover(index: number, svgEl: Element | null): void {
    const edge = this.graph?.edges[index];
    if (!edge || !svgEl) {
      this.edgePopover.hide();
      return;
    }
    const { x, y } = this.host.anchor(svgEl, 'center');
    this.edgePopover.show({
      visible: true,
      x,
      y,
      label: edge.label ?? '',
      style: edge.style ?? 'arrow',
      onLabelChange: (label) => this.commit({ kind: 'setEdgeLabel', index, label }),
      onStyleChange: (style) => this.commit({ kind: 'setEdgeStyle', index, style }),
      onDelete: () => {
        // The selection is about to be stale — clear it BEFORE
        // committing so the re-render (synchronous on a cache hit)
        // doesn't re-highlight the edge that moves into this index.
        this.selected = null;
        this.host.dom.classList.remove('mermaid-has-selection');
        this.edgePopover.hide();
        this.commit({ kind: 'deleteEdge', index });
      },
      onClose: () => this.edgePopover.hide(),
    });
  }

  private refreshDirectionPicker(): void {
    if (!this.graph || this.graph.nodes.size === 0) {
      this.directionPicker.hide();
      return;
    }
    this.directionPicker.show({
      visible: true,
      direction: this.graph.direction,
      onDirectionChange: (direction) => this.commit({ kind: 'setDirection', direction }),
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

  private createFirstNode(): void {
    this.commit({ kind: 'addNode', shape: 'rect', label: '' }, (r) => {
      if (r.id) this.pendingSelect = { id: r.id };
    });
  }

  // ── connect mode ───────────────────────────────────────────────────

  private enterConnectMode(sourceId: string): void {
    this.connectMode = { sourceId };
    this.host.dom.classList.add('mermaid-connect-mode');
    this.nodePopover.hide();
    this.edgePopover.hide();
    this.banner.show({
      visible: true,
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
    if (!this.connectMode) return;
    const sourceId = this.connectMode.sourceId;
    this.commit({ kind: 'addNode', shape: 'rect', label: '', connectFrom: sourceId }, (r) => {
      if (r.id) this.pendingSelect = { id: r.id };
    });
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
