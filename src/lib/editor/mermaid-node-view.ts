// NodeView for code_block nodes whose attrs.language === 'mermaid'.
// Renders the diagram using the mermaid singleton, layered over PM's
// hidden source surface. Click selects a node/edge; Task 5 wires a
// floating popover (label input, shape picker, delete, +connect stub)
// whose edits flow back through the graph -> serializer -> PM
// transaction -> NodeView.update() loop, which triggers a re-render.
import type { Node } from 'prosemirror-model';
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from 'prosemirror-view';
import { mount, unmount } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import MermaidNodePopover from '../../components/MermaidNodePopover.svelte';
import MermaidEdgePopover from '../../components/MermaidEdgePopover.svelte';
import { parseMermaid } from './mermaid-parser';
import {
  setNodeLabel,
  setNodeShape,
  deleteNode,
  setEdgeLabel,
  deleteEdge,
  type MermaidGraph,
  type MermaidShape,
} from './mermaid-graph';
import { serializeMermaid } from './mermaid-serializer';

let mermaidSingleton: typeof import('mermaid').default | null = null;
async function getMermaid() {
  if (mermaidSingleton) return mermaidSingleton;
  const m = await import('mermaid');
  const mermaid = m.default;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
  });
  mermaidSingleton = mermaid;
  return mermaid;
}

let renderId = 0;

type MermaidSelection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; from: string; to: string }
  | null;

// State pushed into the popover via a Svelte store. The popover
// component subscribes; the NodeView writes here whenever selection or
// graph state changes.
interface PopoverState {
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

const HIDDEN_POPOVER_STATE: PopoverState = {
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

// Edge popover mirrors the node popover but smaller — just label +
// delete. Same store-backed pattern so the input keeps focus across
// re-renders.
interface EdgePopoverState {
  visible: boolean;
  x: number;
  y: number;
  label: string;
  onLabelChange: (label: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

const HIDDEN_EDGE_POPOVER_STATE: EdgePopoverState = {
  visible: false,
  x: 0,
  y: 0,
  label: '',
  onLabelChange: () => {},
  onDelete: () => {},
  onClose: () => {},
};

export class MermaidNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: Node;
  private view: EditorView;
  private getPos: () => number | undefined;
  private renderedEl: HTMLElement;
  private popoverHost: HTMLElement;
  private edgePopoverHost: HTMLElement;
  private selected: MermaidSelection = null;
  // Latest successfully-parsed graph, refreshed in renderFromNode. Used
  // by edit handlers to mutate -> serialize -> commit. null when the
  // current source doesn't parse (fallback mode); edit ops no-op then.
  private graph: MermaidGraph | null = null;
  // Single popover instance, mounted once and updated via the store.
  // Keeping it mounted (rather than re-mounting on every selection)
  // preserves the input's focus/caret while typing.
  private popoverStore: Writable<PopoverState>;
  private popoverInstance: ReturnType<typeof mount> | null = null;
  // Edge popover — separate host/store/instance so its DOM doesn't
  // collide with the node popover's, and so we can show one or the
  // other (mutual exclusivity is enforced in selectGraph*).
  private edgePopoverStore: Writable<EdgePopoverState>;
  private edgePopoverInstance: ReturnType<typeof mount> | null = null;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Outer wrapper holds both the rendered SVG and PM's <code> source
    // (which we keep in the DOM but visually hidden so PM still owns
    // the text — needed for round-trip and for source-as-fallback if
    // the rendered side ever blows up).
    const wrap = document.createElement('div');
    wrap.className = 'mermaid-block-editor';

    const rendered = document.createElement('div');
    rendered.className = 'mermaid-rendered';

    // Source container — required by PM as contentDOM but hidden from
    // the user. We use a <pre><code> shape so any future debug-toggle
    // (or fallback) can reuse the existing code-block CSS.
    const pre = document.createElement('pre');
    pre.className = 'mermaid-source';
    const code = document.createElement('code');
    code.className = 'language-mermaid';
    pre.appendChild(code);

    // Host elements for the Svelte popovers. Absolute-positioned
    // children (the popovers themselves) are placed via inline left/top
    // set from the SVG's bounding rect. Hosts have no styling of their
    // own. Two separate hosts so the two popovers' DOMs don't collide.
    const popoverHost = document.createElement('div');
    popoverHost.className = 'mermaid-popover-host';
    const edgePopoverHost = document.createElement('div');
    edgePopoverHost.className = 'mermaid-popover-host mermaid-edge-popover-host';

    wrap.appendChild(rendered);
    wrap.appendChild(pre);
    wrap.appendChild(popoverHost);
    wrap.appendChild(edgePopoverHost);

    this.dom = wrap;
    this.contentDOM = code;
    this.renderedEl = rendered;
    this.popoverHost = popoverHost;
    this.edgePopoverHost = edgePopoverHost;

    // Mount the popovers once. We update their state via the stores so
    // the inputs keep focus/caret across re-renders.
    this.popoverStore = writable<PopoverState>({ ...HIDDEN_POPOVER_STATE });
    this.popoverInstance = mount(MermaidNodePopover, {
      target: this.popoverHost,
      props: { stateStore: this.popoverStore },
    });
    this.edgePopoverStore = writable<EdgePopoverState>({ ...HIDDEN_EDGE_POPOVER_STATE });
    this.edgePopoverInstance = mount(MermaidEdgePopover, {
      target: this.edgePopoverHost,
      props: { stateStore: this.edgePopoverStore },
    });

    // Wire click delegation once on the rendered container. Subsequent
    // mermaid renders replace innerHTML inside renderedEl but don't
    // touch renderedEl itself, so the listener stays.
    this.wireClickHandlers();

    // First render. Subsequent renders happen via update().
    void this.renderFromNode(node);
  }

  private wireClickHandlers(): void {
    this.renderedEl.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      if (!target) return;
      const nodeEl = target.closest(
        'g.node[id^="flowchart-"]',
      ) as SVGGElement | null;
      if (nodeEl) {
        const m = /^flowchart-([A-Za-z][A-Za-z0-9_]*)/.exec(nodeEl.id);
        if (m) {
          this.selectGraphNode(m[1]);
          e.stopPropagation();
          return;
        }
      }
      const edgeEl = target.closest(
        'path.flowchart-link[id^="L-"]',
      ) as SVGPathElement | null;
      if (edgeEl) {
        const m = /^L-([A-Za-z][A-Za-z0-9_]*)-([A-Za-z][A-Za-z0-9_]*)/.exec(
          edgeEl.id,
        );
        if (m) {
          this.selectGraphEdge(m[1], m[2]);
          e.stopPropagation();
          return;
        }
      }
      // Click on empty diagram area — clear selection.
      this.clearSelection();
    });
  }

  // Private helpers are named selectGraph* (not selectNode/selectEdge)
  // to avoid clashing with the NodeView interface's optional
  // `selectNode` method, which has a different signature (() => void)
  // and meaning (PM's node-selection visual treatment).
  private selectGraphNode(id: string): void {
    this.selected = { kind: 'node', id };
    this.dom.classList.add('mermaid-has-selection');
    // Highlight the selected SVG node visually.
    this.renderedEl
      .querySelectorAll('g.node.mermaid-selected')
      .forEach((el) => el.classList.remove('mermaid-selected'));
    const svgEl = this.renderedEl.querySelector(
      `g.node[id^="flowchart-${id}-"]`,
    );
    svgEl?.classList.add('mermaid-selected');
    // Mutual exclusivity: switching to a node closes the edge popover.
    this.closeEdgePopover();
    this.openNodePopover(id, svgEl);
  }

  private selectGraphEdge(from: string, to: string): void {
    this.selected = { kind: 'edge', from, to };
    this.dom.classList.add('mermaid-has-selection');
    this.renderedEl
      .querySelectorAll('path.flowchart-link.mermaid-selected')
      .forEach((el) => el.classList.remove('mermaid-selected'));
    const svgEl = this.renderedEl.querySelector(
      `path.flowchart-link[id^="L-${from}-${to}-"]`,
    );
    svgEl?.classList.add('mermaid-selected');
    // Mutual exclusivity: close the node popover, open the edge one.
    this.closePopover();
    this.openEdgePopover(from, to, svgEl);
  }

  private clearSelection(): void {
    this.selected = null;
    this.dom.classList.remove('mermaid-has-selection');
    this.renderedEl
      .querySelectorAll('.mermaid-selected')
      .forEach((el) => el.classList.remove('mermaid-selected'));
    this.closePopover();
    this.closeEdgePopover();
  }

  // Read-only view of the current selection. Tasks 5-6 use this to
  // drive popover content; exposed here so the field actually has a
  // reader (and so downstream code doesn't need to reach into private
  // state).
  getSelection(): MermaidSelection {
    return this.selected;
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    if (String(node.attrs.language || '') !== 'mermaid') return false;
    const oldText = this.node.textContent;
    const newText = node.textContent;
    this.node = node;
    if (newText !== oldText) {
      void this.renderFromNode(node);
    }
    return true;
  }

  // Block PM from interpreting clicks inside the rendered preview as
  // cursor moves into the source (the source is hidden anyway, but
  // keeps the editor from doing surprising things). Same for clicks
  // inside the popover host — those are real UI events for our Svelte
  // component, not PM input.
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return (
      target.closest('.mermaid-rendered') !== null ||
      target.closest('.mermaid-popover-host') !== null
    );
  }

  // The rendered side is non-content — we generate it ourselves via
  // mermaid.render and write innerHTML. PM's mutation observer
  // shouldn't redraw on our writes. Same for the popover host: it's
  // owned by Svelte, not PM.
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target;
    if (!target) return false;
    const targetEl =
      target.nodeType === 1
        ? (target as Element)
        : target.parentElement;
    return (
      targetEl?.closest('.mermaid-rendered') !== null ||
      targetEl?.closest('.mermaid-popover-host') !== null
    );
  }

  // Cleanup when PM tears down the NodeView (block removed, editor
  // destroyed, etc.). Without this the Svelte component would leak.
  destroy(): void {
    this.closePopover();
    this.closeEdgePopover();
    if (this.popoverInstance) {
      try {
        unmount(this.popoverInstance);
      } catch {
        // Best-effort — if Svelte already cleaned up, ignore.
      }
      this.popoverInstance = null;
    }
    if (this.edgePopoverInstance) {
      try {
        unmount(this.edgePopoverInstance);
      } catch {
        // Best-effort — if Svelte already cleaned up, ignore.
      }
      this.edgePopoverInstance = null;
    }
  }

  private async renderFromNode(node: Node): Promise<void> {
    const source = node.textContent;
    const parsed = parseMermaid(source);
    if (parsed.ok) {
      this.graph = parsed.graph;
      this.dom.classList.remove('mermaid-fallback');
    } else {
      this.graph = null;
      this.dom.classList.add('mermaid-fallback');
    }

    try {
      const mermaid = await getMermaid();
      const id = `remarkdown-mermaid-${++renderId}`;
      const { svg } = await mermaid.render(id, source);
      this.renderedEl.innerHTML = svg;
      // After re-rendering the SVG, the previously-selected element no
      // longer exists. Re-apply the highlight + reposition the popover
      // against the new SVG element if a selection is still active.
      if (this.selected?.kind === 'node' && this.graph?.nodes.has(this.selected.id)) {
        this.selectGraphNode(this.selected.id);
      } else if (this.selected?.kind === 'node') {
        // The node we had selected is gone (e.g. user just deleted it).
        this.clearSelection();
      } else if (this.selected?.kind === 'edge') {
        const { from, to } = this.selected;
        const stillExists = this.graph?.edges.some((e) => e.from === from && e.to === to);
        if (stillExists) {
          this.selectGraphEdge(from, to);
        } else {
          // Edge was deleted (or its endpoints were).
          this.clearSelection();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.renderedEl.innerHTML = '';
      const errBox = document.createElement('pre');
      errBox.className = 'mermaid-error';
      errBox.textContent = `Mermaid error: ${msg}`;
      this.renderedEl.appendChild(errBox);
    }
  }

  // Replace the code_block's text with newSource. PM applies the
  // transaction, our update() fires, renderFromNode re-parses and
  // re-renders the SVG. Single source of truth: the document.
  private commitGraphChange(newSource: string): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const tr = this.view.state.tr.replaceWith(
      pos + 1,
      pos + 1 + node.content.size,
      this.view.state.schema.text(newSource),
    );
    this.view.dispatch(tr);
  }

  private openNodePopover(id: string, svgEl: Element | null): void {
    const node = this.graph?.nodes.get(id);
    if (!node) {
      this.closePopover();
      return;
    }
    // Position relative to the editor-shell ancestor so the popover
    // tracks with the editor's scroll/layout. Fallback to the wrapper
    // itself if no shell is present (unit tests, embedded usage).
    let x = 0;
    let y = 0;
    if (svgEl && typeof (svgEl as SVGGraphicsElement).getBoundingClientRect === 'function') {
      const rect = (svgEl as SVGGraphicsElement).getBoundingClientRect();
      const shellEl = this.dom.closest<HTMLElement>('.editor-shell');
      const anchor = shellEl ?? this.dom;
      const anchorRect = anchor.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      x = rect.right - anchorRect.left + 8;
      y = rect.top - anchorRect.top;
    }
    this.popoverStore.set({
      visible: true,
      x,
      y,
      label: node.label,
      shape: node.shape,
      onLabelChange: (label) => this.handleLabelChange(id, label),
      onShapeChange: (shape) => this.handleShapeChange(id, shape),
      onDelete: () => this.handleDeleteNode(id),
      onAddConnection: () => {
        // Task 7: enter add-connection mode. Stub for now.
      },
      onClose: () => this.closePopover(),
    });
  }

  private closePopover(): void {
    this.popoverStore.set({ ...HIDDEN_POPOVER_STATE });
  }

  private handleLabelChange(id: string, label: string): void {
    if (!this.graph) return;
    const newGraph = setNodeLabel(this.graph, id, label);
    this.graph = newGraph;
    this.commitGraphChange(serializeMermaid(newGraph));
  }

  private handleShapeChange(id: string, shape: MermaidShape): void {
    if (!this.graph) return;
    const newGraph = setNodeShape(this.graph, id, shape);
    this.graph = newGraph;
    this.commitGraphChange(serializeMermaid(newGraph));
  }

  private handleDeleteNode(id: string): void {
    if (!this.graph) return;
    const newGraph = deleteNode(this.graph, id);
    this.graph = newGraph;
    this.commitGraphChange(serializeMermaid(newGraph));
    this.closePopover();
  }

  private openEdgePopover(from: string, to: string, svgEl: Element | null): void {
    if (!this.graph || !svgEl) {
      this.closeEdgePopover();
      return;
    }
    // Find the edge index in graph.edges. If multiple edges go from→to,
    // pick the FIRST. (Duplicates are rare and an edge-edit popover
    // can't disambiguate visually anyway.)
    const index = this.graph.edges.findIndex((e) => e.from === from && e.to === to);
    if (index === -1) {
      this.closeEdgePopover();
      return;
    }
    const edge = this.graph.edges[index];
    // Position at the midpoint of the path's bounding rect — edges are
    // line shapes, so midpoint feels more natural than top-right.
    let x = 0;
    let y = 0;
    if (typeof (svgEl as SVGGraphicsElement).getBoundingClientRect === 'function') {
      const rect = (svgEl as SVGGraphicsElement).getBoundingClientRect();
      const shellEl = this.dom.closest<HTMLElement>('.editor-shell');
      const anchor = shellEl ?? this.dom;
      const anchorRect = anchor.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      x = (rect.left + rect.right) / 2 - anchorRect.left;
      y = (rect.top + rect.bottom) / 2 - anchorRect.top;
    }
    this.edgePopoverStore.set({
      visible: true,
      x,
      y,
      label: edge.label ?? '',
      onLabelChange: (label) => this.handleEdgeLabelChange(index, label),
      onDelete: () => this.handleDeleteEdge(index),
      onClose: () => this.closeEdgePopover(),
    });
  }

  private closeEdgePopover(): void {
    this.edgePopoverStore.set({ ...HIDDEN_EDGE_POPOVER_STATE });
  }

  private handleEdgeLabelChange(index: number, label: string): void {
    if (!this.graph) return;
    const newGraph = setEdgeLabel(this.graph, index, label);
    this.graph = newGraph;
    this.commitGraphChange(serializeMermaid(newGraph));
  }

  private handleDeleteEdge(index: number): void {
    if (!this.graph) return;
    const newGraph = deleteEdge(this.graph, index);
    this.graph = newGraph;
    this.commitGraphChange(serializeMermaid(newGraph));
    this.closeEdgePopover();
    // Selection is now stale — clear it so subsequent re-renders don't
    // try to re-highlight the deleted edge.
    this.selected = null;
    this.dom.classList.remove('mermaid-has-selection');
  }
}
