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
import MermaidConnectBanner from '../../components/MermaidConnectBanner.svelte';
import { parseMermaid } from './mermaid-parser';
import { detectDiagramType, type MermaidDiagramType } from './mermaid-detect';
import {
  addNode,
  addEdge,
  setNodeLabel,
  setNodeShape,
  deleteNode,
  setEdgeLabel,
  setEdgeStyle,
  deleteEdge,
  type MermaidGraph,
  type MermaidShape,
  type EdgeStyle,
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

// Edge popover mirrors the node popover but smaller — label, style
// picker (4 styles: arrow / line / dotted / thick), delete. Same
// store-backed pattern so the input keeps focus across re-renders.
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

const HIDDEN_EDGE_POPOVER_STATE: EdgePopoverState = {
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

// Connect-mode banner state (Task 7). Shown while the NodeView is in
// connect mode (after the user clicks "+ connect" on a node popover).
// The banner offers a "+ Add new node" shortcut and a Cancel button;
// the actual click-to-target-node logic lives in wireClickHandlers.
interface BannerState {
  visible: boolean;
  onAddNewNode: () => void;
  onCancel: () => void;
}

const HIDDEN_BANNER_STATE: BannerState = {
  visible: false,
  onAddNewNode: () => {},
  onCancel: () => {},
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
  // Diagram type detected from the source, refreshed in renderFromNode.
  // The wireClickHandlers dispatch only runs flowchart-specific routing
  // when this is 'flowchart'; sequence (Tasks 2-8) and unsupported
  // diagrams skip the popover wiring.
  private diagramType: MermaidDiagramType = 'unsupported';
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
  // Connect-mode state (Task 7). Non-null while the user is picking a
  // target for a new edge. The banner is mounted at construction time,
  // visibility is toggled via the store. The Esc listener is attached
  // to `document` while in connect-mode and removed on exit.
  private connectMode: { sourceId: string } | null = null;
  private connectBannerHost: HTMLElement;
  private connectBannerStore: Writable<BannerState>;
  private connectBannerInstance: ReturnType<typeof mount> | null = null;
  private escListener: ((e: KeyboardEvent) => void) | null = null;

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
    // Mark the rendered SVG container non-editable so:
    //   1. The browser can't put PM's text cursor inside it on click —
    //      otherwise clicks on the diagram land the cursor inside the
    //      mermaid code_block, and every toolbar insert (callout / code
    //      / tasks / table / mermaid) refuses because they all guard
    //      on `$from.parent.type.name === 'code_block'`.
    //   2. Mermaid renders edge labels and node text inside <foreignObject>
    //      (HTML inside SVG). Without contenteditable=false those inherit
    //      PM's contenteditable=true and the user can type directly into
    //      the live SVG — corrupting the doc since PM doesn't know about
    //      the change. Click-to-edit goes through our popovers only.
    rendered.contentEditable = 'false';

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
    // Banner host shares the popover-host class so stopEvent / ignore-
    // mutation gates apply to it too — clicks on the banner are real
    // UI events, not PM input.
    const connectBannerHost = document.createElement('div');
    connectBannerHost.className = 'mermaid-popover-host mermaid-connect-banner-host';

    wrap.appendChild(rendered);
    wrap.appendChild(pre);
    wrap.appendChild(popoverHost);
    wrap.appendChild(edgePopoverHost);
    wrap.appendChild(connectBannerHost);

    this.dom = wrap;
    this.contentDOM = code;
    this.renderedEl = rendered;
    this.popoverHost = popoverHost;
    this.edgePopoverHost = edgePopoverHost;
    this.connectBannerHost = connectBannerHost;

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
    this.connectBannerStore = writable<BannerState>({ ...HIDDEN_BANNER_STATE });
    this.connectBannerInstance = mount(MermaidConnectBanner, {
      target: this.connectBannerHost,
      props: { stateStore: this.connectBannerStore },
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

      // Diagram-type dispatch. Flowchart routing (node/edge selection,
      // connect-mode) only applies to flowchart sources. Sequence
      // (Tasks 4-8) and unsupported diagrams fall through with no
      // popovers wired — sequence-specific click routing is Task 4's
      // job, and unsupported diagrams stay render-only.
      if (this.diagramType === 'flowchart') {
        // Connect mode (Task 7): clicks pick a target for a new edge,
        // or fall through to cancel. We check this BEFORE the normal
        // selection paths so that e.g. clicking an existing node while
        // in connect-mode adds an edge instead of selecting it.
        if (this.connectMode) {
          const nodeEl = target.closest(
            'g.node[id*="flowchart-"]',
          ) as SVGGElement | null;
          if (nodeEl) {
            const m = /flowchart-([A-Za-z][A-Za-z0-9_]*)/.exec(nodeEl.id);
            if (m) {
              const targetId = m[1];
              // Self-loop: silently ignore the click but exit connect-
              // mode (no edge added). Either ignore-only or ignore+exit
              // is acceptable per spec; exiting is less surprising.
              if (targetId !== this.connectMode.sourceId && this.graph) {
                const newGraph = addEdge(this.graph, {
                  from: this.connectMode.sourceId,
                  to: targetId,
                });
                this.graph = newGraph;
                this.commitGraphChange(serializeMermaid(newGraph));
              }
              this.exitConnectMode();
              e.stopPropagation();
              return;
            }
          }
          // Empty-area click in connect-mode: cancel without an edge.
          this.exitConnectMode();
          e.stopPropagation();
          return;
        }

        const nodeEl = target.closest(
          'g.node[id*="flowchart-"]',
        ) as SVGGElement | null;
        if (nodeEl) {
          const m = /flowchart-([A-Za-z][A-Za-z0-9_]*)/.exec(nodeEl.id);
          if (m) {
            this.selectGraphNode(m[1]);
            e.stopPropagation();
            return;
          }
        }
        // Edge detection. Mermaid 11 emits two clickable surfaces per edge:
        //   1. The path: `<path class="flowchart-link" id="${diagramId}-L_A_B_0"
        //      data-id="L_A_B_0">`
        //   2. The label: `<g class="edgeLabel">` containing
        //      `<g class="label" data-id="L_A_B_0">` wrapping a <foreignObject>.
        //      Clicks on the "Yes"/"No" text land somewhere inside the
        //      foreignObject (a <span>), which is a sibling of the path —
        //      walking up via `path.flowchart-link` would never find it.
        // Both surfaces carry a `data-id="L_${from}_${to}_${counter}"` (NOTE:
        // underscores, not dashes — this differs from mermaid's `flowchart-A-0`
        // node ids which DO use dashes). The previous selector matched
        // `[id*="L-"]` and never fired in the browser. Match by data-id, which
        // works for both the path and the label container.
        const edgeWithDataId = target.closest('[data-id^="L_"]') as Element | null;
        if (edgeWithDataId) {
          const dataId = edgeWithDataId.getAttribute('data-id') ?? '';
          const m = /^L_([A-Za-z][A-Za-z0-9_]*)_([A-Za-z][A-Za-z0-9_]*)_/.exec(dataId);
          if (m) {
            this.selectGraphEdge(m[1], m[2]);
            e.stopPropagation();
            return;
          }
        }
        // Click on empty diagram area — clear selection.
        this.clearSelection();
      }
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
      `g.node[id*="flowchart-${id}-"]`,
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
    // Look up the path by `data-id` rather than `id` — see the comment in
    // wireClickHandlers about underscores-vs-dashes. We match the `_<counter>`
    // tail so a `data-id="L_A_B_0"` matches but `L_A_BB_0` doesn't (the
    // underscore-counter suffix anchors the prefix).
    const svgEl = this.renderedEl.querySelector(
      `path.flowchart-link[data-id^="L_${from}_${to}_"]`,
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
    if (
      targetEl?.closest('.mermaid-rendered') !== null ||
      targetEl?.closest('.mermaid-popover-host') !== null
    ) {
      return true;
    }
    // Class-only mutations on the wrapper itself (e.g. our own
    // .mermaid-has-selection / .mermaid-connect-mode toggles) are UI
    // state, not document content — without this PM treats them as a
    // real mutation and re-builds the NodeView, which destroys the
    // popover before it can render.
    if (
      mutation.type === 'attributes' &&
      (mutation as MutationRecord).attributeName === 'class' &&
      targetEl === this.dom
    ) {
      return true;
    }
    return false;
  }

  // Cleanup when PM tears down the NodeView (block removed, editor
  // destroyed, etc.). Without this the Svelte component would leak.
  destroy(): void {
    this.closePopover();
    this.closeEdgePopover();
    // Belt-and-braces: exitConnectMode also removes the listener, but
    // PM may tear us down without the user explicitly leaving connect-
    // mode first.
    if (this.escListener) {
      document.removeEventListener('keydown', this.escListener);
      this.escListener = null;
    }
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
    if (this.connectBannerInstance) {
      try {
        unmount(this.connectBannerInstance);
      } catch {
        // Best-effort — if Svelte already cleaned up, ignore.
      }
      this.connectBannerInstance = null;
    }
  }

  private async renderFromNode(node: Node): Promise<void> {
    const source = node.textContent;
    const type = detectDiagramType(source);
    this.diagramType = type;

    // Track whether the flowchart parser succeeded so the empty-state
    // placeholder check below can still see it. Sequence + unsupported
    // skip the parser entirely and never show the placeholder.
    let flowchartParsed: ReturnType<typeof parseMermaid> | null = null;

    if (type === 'flowchart') {
      flowchartParsed = parseMermaid(source);
      if (flowchartParsed.ok) {
        this.graph = flowchartParsed.graph;
        this.dom.classList.remove('mermaid-fallback');
      } else {
        this.graph = null;
        this.dom.classList.add('mermaid-fallback');
      }
    } else if (type === 'sequence') {
      // Sequence parser lands in Task 3. For now, sequence diagrams
      // render but aren't visually editable — same as the flowchart
      // fallback path, just with a different reason.
      this.graph = null;
      this.dom.classList.add('mermaid-fallback');
    } else {
      // Unsupported diagram type (classDiagram, gantt, legacy `graph`,
      // etc.): render via mermaid as fallback, no editing.
      this.graph = null;
      this.dom.classList.add('mermaid-fallback');
    }

    // Empty diagram (e.g. fresh `flowchart TD\n` from the toolbar button):
    // skip the mermaid render and show a placeholder with a "+ Add first
    // shape" affordance instead. mermaid would render an empty SVG and
    // there's nothing for the user to click; the placeholder gives them
    // an entry point that opens the node popover for a brand-new node.
    if (flowchartParsed?.ok && flowchartParsed.graph.nodes.size === 0) {
      // Any popover/banner from a previous render would now be orphaned —
      // there are no SVG nodes left to anchor against.
      this.clearSelection();
      this.renderedEl.innerHTML = '';
      const placeholder = document.createElement('button');
      placeholder.type = 'button';
      placeholder.className = 'mermaid-empty-state';
      placeholder.textContent = '+ Add first shape';
      // Mirror toolbar-button behaviour: don't steal focus from PM on
      // mousedown so the surrounding selection survives the click.
      placeholder.addEventListener('mousedown', (e) => e.preventDefault());
      placeholder.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.createFirstNode();
      });
      this.renderedEl.appendChild(placeholder);
      return;
    }

    try {
      const mermaid = await getMermaid();
      const id = `remarkdown-mermaid-${++renderId}`;
      const { svg } = await mermaid.render(id, source);
      this.renderedEl.innerHTML = svg;
      // Mermaid draws edges as 1-2px paths whose hit-test area equals
      // the visible stroke — pixel-precise to click. Inject a wider
      // transparent sibling path for each edge so users have a forgiving
      // hit zone without changing the visual line. The click handler
      // already matches on data-id, so the wider target is picked up
      // automatically without further wiring.
      this.injectEdgeHitTargets();
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

  // Inject a wider transparent hit-target path next to each visible
  // edge path. Mermaid's edges are typically 1.5-2px wide and the
  // browser's hit-test follows the visible stroke — too thin for
  // comfortable clicking. Each hit target is the SAME path with the
  // SAME data-id (so the click handler treats it identically) but
  // 14px transparent stroke and pointer-events: stroke. Inserted
  // BEFORE the visible path so the visible one paints on top.
  private injectEdgeHitTargets(): void {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const paths = this.renderedEl.querySelectorAll(
      'path.flowchart-link[data-id]',
    );
    paths.forEach((path) => {
      // Don't double-inject if a previous render's hit-target survived
      // (it shouldn't — innerHTML replace tears them down too — but
      // guard anyway).
      const dataId = path.getAttribute('data-id') || '';
      const parent = path.parentNode;
      if (!parent) return;
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', path.getAttribute('d') || '');
      // NOTE: deliberately NOT giving the hit target the
      // `flowchart-link` class — that class picks up our hover/selection
      // CSS rules (drop-shadow + accent stroke) which on a 14px-wide
      // band paint a chunky colored ribbon. Keep `mermaid-edge-hit`
      // alone so it stays a quiet dark-gray track regardless of state.
      hit.setAttribute('class', 'mermaid-edge-hit');
      hit.setAttribute('data-id', dataId);
      hit.setAttribute('stroke-width', '14');
      hit.setAttribute('fill', 'none');
      // pointer-events: stroke means the path catches clicks within
      // its (now 14px wide) stroke region. The visible path on top
      // still paints normally — pointer-events on it can stay default
      // because clicks land on whichever path is hit first; either
      // matches our [data-id^="L_"] selector.
      hit.style.pointerEvents = 'stroke';
      parent.insertBefore(hit, path);
    });
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
    // The popover-host is `position: absolute; inset: 0;` inside the
    // wrapper (this.dom), so the popover's left/top are in WRAPPER
    // coordinates — not editor-shell. (The bubble-menu and table-
    // actions-menu use the shell because they live AT the shell level;
    // ours lives one layer deeper.)
    let x = 0;
    let y = 0;
    if (svgEl && typeof (svgEl as SVGGraphicsElement).getBoundingClientRect === 'function') {
      const rect = (svgEl as SVGGraphicsElement).getBoundingClientRect();
      const wrapperRect = this.dom.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      x = rect.right - wrapperRect.left + 8;
      y = rect.top - wrapperRect.top;
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
      onAddConnection: () => this.enterConnectMode(id),
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

  // Connect-mode lifecycle (Task 7). Entered via the "+ connect" button
  // on the node popover. While active: a banner shows over the diagram,
  // the wrapper carries the .mermaid-connect-mode class (Task 9 styles
  // it), the next click on a node adds an edge from `sourceId`, and Esc
  // / empty-area click cancels.
  private enterConnectMode(sourceId: string): void {
    this.connectMode = { sourceId };
    this.dom.classList.add('mermaid-connect-mode');
    // Both popovers are mutually exclusive with connect-mode.
    this.closePopover();
    this.closeEdgePopover();
    this.connectBannerStore.set({
      visible: true,
      onAddNewNode: () => this.addNewNodeInConnectMode(),
      onCancel: () => this.exitConnectMode(),
    });
    // Esc on `document` (not `this.dom`) — focus may be elsewhere when
    // the user wants to bail. Removed in exitConnectMode + destroy.
    this.escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.connectMode) {
        e.preventDefault();
        this.exitConnectMode();
      }
    };
    document.addEventListener('keydown', this.escListener);
  }

  private exitConnectMode(): void {
    this.connectMode = null;
    this.dom.classList.remove('mermaid-connect-mode');
    this.connectBannerStore.set({ ...HIDDEN_BANNER_STATE });
    if (this.escListener) {
      document.removeEventListener('keydown', this.escListener);
      this.escListener = null;
    }
  }

  // Empty-state entry point: the user clicked "+ Add first shape" on
  // a fresh `flowchart TD\n` block. Add a single rect node, commit, and
  // wait for the re-render before opening the popover for it (the SVG
  // doesn't exist until mermaid finishes rendering, and the popover
  // anchors to that SVG element).
  private createFirstNode(): void {
    if (!this.graph) return;
    const result = addNode(this.graph, { shape: 'rect', label: '' });
    this.graph = result.graph;
    this.commitGraphChange(serializeMermaid(this.graph));
    setTimeout(() => {
      if (this.graph?.nodes.has(result.id)) {
        this.selectGraphNode(result.id);
      }
    }, 50);
  }

  private addNewNodeInConnectMode(): void {
    if (!this.connectMode || !this.graph) return;
    const sourceId = this.connectMode.sourceId;
    // Add the node + edge in ONE graph mutation, commit ONCE. Single
    // PM transaction means the renderFromNode pass picks up both at
    // the same time.
    const result = addNode(this.graph, { shape: 'rect', label: '' });
    let g = result.graph;
    g = addEdge(g, { from: sourceId, to: result.id });
    this.graph = g;
    this.commitGraphChange(serializeMermaid(g));
    this.exitConnectMode();
    // Mermaid render is async — wait one tick before opening the
    // popover for the new node, otherwise its SVG element doesn't
    // exist yet and the popover positioning would fall back to (0,0).
    setTimeout(() => {
      if (this.graph?.nodes.has(result.id)) {
        this.selectGraphNode(result.id);
      }
    }, 50);
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
    // Position at the midpoint of the path's bounding rect, in WRAPPER
    // coordinates (the popover-host is absolute inside the wrapper).
    let x = 0;
    let y = 0;
    if (typeof (svgEl as SVGGraphicsElement).getBoundingClientRect === 'function') {
      const rect = (svgEl as SVGGraphicsElement).getBoundingClientRect();
      const wrapperRect = this.dom.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      x = (rect.left + rect.right) / 2 - wrapperRect.left;
      y = (rect.top + rect.bottom) / 2 - wrapperRect.top;
    }
    this.edgePopoverStore.set({
      visible: true,
      x,
      y,
      label: edge.label ?? '',
      style: edge.style ?? 'arrow',
      onLabelChange: (label) => this.handleEdgeLabelChange(index, label),
      onStyleChange: (style) => this.handleEdgeStyleChange(index, style),
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

  private handleEdgeStyleChange(index: number, style: EdgeStyle): void {
    if (!this.graph) return;
    const newGraph = setEdgeStyle(this.graph, index, style);
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
