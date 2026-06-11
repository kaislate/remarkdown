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
import MermaidParticipantPopover from '../../components/MermaidParticipantPopover.svelte';
import MermaidMessagePopover from '../../components/MermaidMessagePopover.svelte';
import MermaidNotePopover from '../../components/MermaidNotePopover.svelte';
import MermaidSequenceActions from '../../components/MermaidSequenceActions.svelte';
import { parseMermaid } from './mermaid-parser';
import { parseSequence } from './mermaid-sequence-parser';
import {
  addParticipant,
  setParticipantDisplay,
  deleteParticipant,
  addMessage,
  setMessageText,
  setMessageStyle,
  deleteMessage,
  addNote,
  setNoteText,
  setNotePosition,
  deleteNote,
  type SequenceGraph,
  type MessageStyle,
  type NotePosition,
} from './mermaid-sequence-graph';
import { serializeSequence } from './mermaid-sequence-serializer';
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

// Sequence-diagram selection state (Task 4). Kept in a separate field
// from `selected` (the flowchart selection) because the two diagram
// kinds have disjoint click targets and never coexist — diagramType
// dispatches to one or the other.
type SequenceSelection =
  | { kind: 'participant'; id: string }
  | { kind: 'message'; index: number }
  | { kind: 'note'; index: number }
  | null;

// Selection to apply once the in-flight render completes. The add-
// element flows know the new element's identity before its SVG exists;
// they stash it here and renderFromNode consumes it after writing the
// SVG, so the popover anchors against a real element instead of racing
// the render with a timeout.
type PendingSelect =
  | { kind: 'node'; id: string }
  | { kind: 'participant'; id: string }
  | { kind: 'message'; index: number }
  | { kind: 'note'; index: number };

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

// Participant popover state (Task 5). Sequence-diagram analogue of
// EdgePopoverState — display-name input + delete (no style picker, no
// "+ connect"). Same store-backed pattern so the input keeps focus
// across re-renders.
interface ParticipantPopoverState {
  visible: boolean;
  x: number;
  y: number;
  display: string;
  onDisplayChange: (display: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

const HIDDEN_PARTICIPANT_POPOVER_STATE: ParticipantPopoverState = {
  visible: false,
  x: 0,
  y: 0,
  display: '',
  onDisplayChange: () => {},
  onDelete: () => {},
  onClose: () => {},
};

// Message popover state (Task 6). Sequence-diagram analogue of
// EdgePopoverState — text input + 4-button style picker (solid /
// arrow / dotted / reply) + delete. Same store-backed pattern so the
// input keeps focus across re-renders.
interface MessagePopoverState {
  visible: boolean;
  x: number;
  y: number;
  text: string;
  style: MessageStyle;
  onTextChange: (text: string) => void;
  onStyleChange: (style: MessageStyle) => void;
  onDelete: () => void;
  onAddAfter: () => void;
  onClose: () => void;
}

const HIDDEN_MESSAGE_POPOVER_STATE: MessagePopoverState = {
  visible: false,
  x: 0,
  y: 0,
  text: '',
  style: 'arrow',
  onTextChange: () => {},
  onStyleChange: () => {},
  onDelete: () => {},
  onAddAfter: () => {},
  onClose: () => {},
};

// Note popover state (Task 7 of Phase 2g). Sequence-diagram analogue of
// MessagePopoverState — text input + 3-button position picker (leftOf /
// rightOf / over) + optional second participant <select> (only shown
// when position === 'over') + delete. Same store-backed pattern so the
// input keeps focus across re-renders.
interface NotePopoverState {
  visible: boolean;
  x: number;
  y: number;
  text: string;
  position: NotePosition;
  primaryParticipant: string;
  secondaryParticipant: string;
  availableParticipants: string[];
  onTextChange: (text: string) => void;
  onPositionChange: (position: NotePosition) => void;
  onSecondaryChange: (secondaryId: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

const HIDDEN_NOTE_POPOVER_STATE: NotePopoverState = {
  visible: false,
  x: 0,
  y: 0,
  text: '',
  position: 'rightOf',
  primaryParticipant: '',
  secondaryParticipant: '',
  availableParticipants: [],
  onTextChange: () => {},
  onPositionChange: () => {},
  onSecondaryChange: () => {},
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

// Floating action-bar state (Task 8 of Phase 2g). The bar lives over
// the rendered SVG and exposes "+ Participant" / "+ Message" / "+ Note"
// entry points. Visibility is conditional on diagram type + participant
// count: hidden when in flowchart / unsupported / fallback / empty
// states (the empty-state placeholder handles the empty case itself).
interface ActionsState {
  visible: boolean;
  canAddParticipant: boolean;
  canAddMessage: boolean;
  canAddNote: boolean;
  onAddParticipant: () => void;
  onAddMessage: () => void;
  onAddNote: () => void;
}

const HIDDEN_ACTIONS_STATE: ActionsState = {
  visible: false,
  canAddParticipant: false,
  canAddMessage: false,
  canAddNote: false,
  onAddParticipant: () => {},
  onAddMessage: () => {},
  onAddNote: () => {},
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
  // Parallel field for sequence diagrams (Task 4). Mutually exclusive
  // with `graph` — at most one of them is non-null at a time, governed
  // by `diagramType`. null in flowchart mode and in fallback mode.
  private sequenceGraph: SequenceGraph | null = null;
  // Sequence-diagram selection state (Task 4). Disjoint from `selected`
  // (flowchart). When diagramType !== 'sequence' this is always null.
  private sequenceSelected: SequenceSelection = null;
  // Monotonic counter for renders in flight. renderFromNode captures
  // the value at entry and bails before touching the DOM if a newer
  // render has started since — without this, a slow older render (the
  // first one pays the dynamic import of mermaid) can resolve AFTER a
  // newer one and clobber the fresh SVG with stale output.
  private renderSeq = 0;
  // See PendingSelect above. Set by add-element flows just before they
  // commit; consumed (and cleared) by renderFromNode once the new SVG
  // is in the DOM.
  private pendingSelect: PendingSelect | null = null;
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
  // Participant popover (Task 5) — separate host/store/instance for the
  // sequence-diagram participant editor. Mutually exclusive with the
  // flowchart popovers; selectParticipant closes those before opening
  // this one.
  private participantPopoverHost: HTMLElement;
  private participantPopoverStore: Writable<ParticipantPopoverState>;
  private participantPopoverInstance: ReturnType<typeof mount> | null = null;
  // Message popover (Task 6) — separate host/store/instance for the
  // sequence-diagram message editor. Mutually exclusive with every
  // other popover; selectMessage closes the participant + flowchart
  // popovers before opening this one.
  private messagePopoverHost: HTMLElement;
  private messagePopoverStore: Writable<MessagePopoverState>;
  private messagePopoverInstance: ReturnType<typeof mount> | null = null;
  // Note popover (Task 7 of Phase 2g) — separate host/store/instance for
  // the sequence-diagram note editor. Mutually exclusive with every
  // other popover; selectNote closes the participant + message + flow-
  // chart popovers before opening this one.
  private notePopoverHost: HTMLElement;
  private notePopoverStore: Writable<NotePopoverState>;
  private notePopoverInstance: ReturnType<typeof mount> | null = null;
  // Connect-mode state (Task 7). Non-null while the user is picking a
  // target for a new edge. The banner is mounted at construction time,
  // visibility is toggled via the store. The Esc listener is attached
  // to `document` while in connect-mode and removed on exit.
  private connectMode: { sourceId: string } | null = null;
  private connectBannerHost: HTMLElement;
  private connectBannerStore: Writable<BannerState>;
  private connectBannerInstance: ReturnType<typeof mount> | null = null;
  private escListener: ((e: KeyboardEvent) => void) | null = null;
  // Add-message mode (Task 8 of Phase 2g). Two-step: first click on a
  // participant header records FROM; second click records TO and
  // commits a new message + opens its popover. Esc / empty-area click
  // cancels. Reuses the connectBanner store for visual feedback (a slight
  // semantic stretch — banner copy is generic enough).
  private addMessageMode: { from: string | null } | null = null;
  // Floating action bar (Task 8 of Phase 2g) — hosts "+ Participant" /
  // "+ Message" / "+ Note" buttons. Visibility + per-button enablement
  // are recomputed in refreshActionsBar after every render.
  private sequenceActionsHost: HTMLElement;
  private sequenceActionsStore: Writable<ActionsState>;
  private sequenceActionsInstance: ReturnType<typeof mount> | null = null;

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
    // Sequence participant popover host (Task 5). Same shared host class
    // as the flowchart popovers so stopEvent / ignoreMutation gates apply.
    const participantPopoverHost = document.createElement('div');
    participantPopoverHost.className =
      'mermaid-popover-host mermaid-participant-popover-host';
    // Sequence message popover host (Task 6). Same shared host class.
    const messagePopoverHost = document.createElement('div');
    messagePopoverHost.className =
      'mermaid-popover-host mermaid-message-popover-host';
    // Sequence note popover host (Task 7 of Phase 2g). Same shared host class.
    const notePopoverHost = document.createElement('div');
    notePopoverHost.className =
      'mermaid-popover-host mermaid-note-popover-host';
    // Banner host shares the popover-host class so stopEvent / ignore-
    // mutation gates apply to it too — clicks on the banner are real
    // UI events, not PM input.
    const connectBannerHost = document.createElement('div');
    connectBannerHost.className = 'mermaid-popover-host mermaid-connect-banner-host';
    // Action-bar host (Task 8 of Phase 2g). Same shared host class so
    // stopEvent / ignoreMutation gates apply — clicks on the bar are
    // real UI events, not PM input.
    const sequenceActionsHost = document.createElement('div');
    sequenceActionsHost.className =
      'mermaid-popover-host mermaid-sequence-actions-host';

    wrap.appendChild(rendered);
    wrap.appendChild(pre);
    wrap.appendChild(popoverHost);
    wrap.appendChild(edgePopoverHost);
    wrap.appendChild(participantPopoverHost);
    wrap.appendChild(messagePopoverHost);
    wrap.appendChild(notePopoverHost);
    wrap.appendChild(connectBannerHost);
    wrap.appendChild(sequenceActionsHost);

    this.dom = wrap;
    this.contentDOM = code;
    this.renderedEl = rendered;
    this.popoverHost = popoverHost;
    this.edgePopoverHost = edgePopoverHost;
    this.participantPopoverHost = participantPopoverHost;
    this.messagePopoverHost = messagePopoverHost;
    this.notePopoverHost = notePopoverHost;
    this.connectBannerHost = connectBannerHost;
    this.sequenceActionsHost = sequenceActionsHost;

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
    this.participantPopoverStore = writable<ParticipantPopoverState>({
      ...HIDDEN_PARTICIPANT_POPOVER_STATE,
    });
    this.participantPopoverInstance = mount(MermaidParticipantPopover, {
      target: this.participantPopoverHost,
      props: { stateStore: this.participantPopoverStore },
    });
    this.messagePopoverStore = writable<MessagePopoverState>({
      ...HIDDEN_MESSAGE_POPOVER_STATE,
    });
    this.messagePopoverInstance = mount(MermaidMessagePopover, {
      target: this.messagePopoverHost,
      props: { stateStore: this.messagePopoverStore },
    });
    this.notePopoverStore = writable<NotePopoverState>({
      ...HIDDEN_NOTE_POPOVER_STATE,
    });
    this.notePopoverInstance = mount(MermaidNotePopover, {
      target: this.notePopoverHost,
      props: { stateStore: this.notePopoverStore },
    });
    this.connectBannerStore = writable<BannerState>({ ...HIDDEN_BANNER_STATE });
    this.connectBannerInstance = mount(MermaidConnectBanner, {
      target: this.connectBannerHost,
      props: { stateStore: this.connectBannerStore },
    });
    this.sequenceActionsStore = writable<ActionsState>({
      ...HIDDEN_ACTIONS_STATE,
    });
    this.sequenceActionsInstance = mount(MermaidSequenceActions, {
      target: this.sequenceActionsHost,
      props: { stateStore: this.sequenceActionsStore },
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
      } else if (this.diagramType === 'sequence') {
        // Add-message mode (Task 8 of Phase 2g): clicks pick FROM, then
        // TO — checked BEFORE normal selection routing so clicks on
        // existing participants add a message instead of selecting.
        if (this.addMessageMode && this.sequenceGraph) {
          const pendingEl = target.closest(
            'g[data-et="participant"]',
          ) as Element | null;
          if (pendingEl) {
            const id = (pendingEl as HTMLElement).dataset.id ?? '';
            if (id && this.sequenceGraph.participants.has(id)) {
              if (this.addMessageMode.from === null) {
                // Pick FROM. Highlight the picked participant header so
                // the user can see what they chose.
                this.addMessageMode = { from: id };
                this.renderedEl
                  .querySelectorAll('.sequence-pending-from')
                  .forEach((el) => el.classList.remove('sequence-pending-from'));
                pendingEl.classList.add('sequence-pending-from');
                e.stopPropagation();
                return;
              }
              // Pick TO. Self-messages (FROM === TO) are intentionally
              // out of scope for this MVP — clicking the same participant
              // a second time is a no-op (we keep the user in mode so
              // they can pick a different TO).
              if (id === this.addMessageMode.from) {
                e.stopPropagation();
                return;
              }
              const from = this.addMessageMode.from;
              const eventsBefore = this.sequenceGraph.events.length;
              const newGraph = addMessage(this.sequenceGraph, {
                from,
                to: id,
                text: '',
                style: 'arrow',
              });
              this.sequenceGraph = newGraph;
              // renderFromNode opens the new arrow's popover via
              // pendingSelect once mermaid has re-rendered it, so the
              // popover anchors to a real SVG rect.
              this.pendingSelect = { kind: 'message', index: eventsBefore };
              this.commitGraphChange(serializeSequence(newGraph));
              this.exitAddMessageMode();
              e.stopPropagation();
              return;
            }
          }
          // Empty-area click while in add-message mode: cancel.
          this.exitAddMessageMode();
          e.stopPropagation();
          return;
        }
        // Sequence-diagram routing (Task 4). Mermaid's sequenceDiagram
        // renderer tags every clickable element with `data-et`:
        //   - `g[data-et="participant"]`  →  participant header (data-id="A")
        //   - `line[data-et="life-line"]` →  vertical lifeline   (data-id="A")
        //   - `[data-et="message"]`       →  arrow path/group     (data-id="i<N>")
        //   - `g[data-et="note"]`         →  note rectangle/text  (data-id="i<N>")
        // The `i<N>` indexes match this.sequenceGraph.events[N] because
        // mermaid pushes both messages and notes into one combined array
        // in source order, and our serializer emits in array order.
        // Popover wiring lands in Tasks 5-7; this branch only sets the
        // selection state + the .sequence-selected highlight class.

        // Participant header → select participant.
        const participantEl = target.closest(
          'g[data-et="participant"]',
        ) as Element | null;
        if (participantEl) {
          const id = (participantEl as HTMLElement).dataset.id ?? '';
          if (id && this.sequenceGraph?.participants.has(id)) {
            this.selectParticipant(id);
            e.stopPropagation();
            return;
          }
        }
        // Lifeline → also select participant (clicking the vertical
        // line is intuitive — it represents the same actor).
        const lifelineEl = target.closest(
          'line[data-et="life-line"]',
        ) as Element | null;
        if (lifelineEl) {
          const id = (lifelineEl as HTMLElement).dataset.id ?? '';
          if (id && this.sequenceGraph?.participants.has(id)) {
            this.selectParticipant(id);
            e.stopPropagation();
            return;
          }
        }
        // Message arrow → select by index.
        const messageEl = target.closest(
          '[data-et="message"]',
        ) as Element | null;
        if (messageEl) {
          const dataId = (messageEl as HTMLElement).dataset.id ?? '';
          const m = /^i(\d+)$/.exec(dataId);
          if (m) {
            const idx = Number.parseInt(m[1], 10);
            const ev = this.sequenceGraph?.events[idx];
            if (ev?.kind === 'message') {
              this.selectMessage(idx);
              e.stopPropagation();
              return;
            }
          }
        }
        // Note → select by index.
        const noteEl = target.closest('g[data-et="note"]') as Element | null;
        if (noteEl) {
          const dataId = (noteEl as HTMLElement).dataset.id ?? '';
          const m = /^i(\d+)$/.exec(dataId);
          if (m) {
            const idx = Number.parseInt(m[1], 10);
            const ev = this.sequenceGraph?.events[idx];
            if (ev?.kind === 'note') {
              this.selectNote(idx);
              e.stopPropagation();
              return;
            }
          }
        }
        // Empty area click — clear sequence selection.
        this.clearSequenceSelection();
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
    // Mutual exclusivity: switching to a node closes the edge popover
    // and any sequence popovers (defensive — sequence + flowchart can't
    // legitimately coexist, but the close calls are cheap).
    this.closeEdgePopover();
    this.closeParticipantPopover();
    this.closeMessagePopover();
    this.closeNotePopover();
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
    // Mutual exclusivity: close the node popover (and any sequence
    // popovers — defensive) and open the edge one.
    this.closePopover();
    this.closeParticipantPopover();
    this.closeMessagePopover();
    this.closeNotePopover();
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
    // Defensive: sequence popovers shouldn't be open in flowchart mode,
    // but clear them in case of a stale state from a diagram-type swap.
    this.closeParticipantPopover();
    this.closeMessagePopover();
    this.closeNotePopover();
  }

  // Read-only view of the current selection. Tasks 5-6 use this to
  // drive popover content; exposed here so the field actually has a
  // reader (and so downstream code doesn't need to reach into private
  // state).
  getSelection(): MermaidSelection {
    return this.selected;
  }

  // Sequence-diagram selection helpers (Task 4). Mirror the flowchart
  // selectGraph* / clearSelection pattern: set state, toggle the
  // wrapper class, swap the .sequence-selected highlight on the SVG.
  // Popover wiring is intentionally absent — it lands in Tasks 5-7.
  // The .sequence-selected class is unstyled until Task 10; that's
  // fine, the selection state is what later tasks build on.
  private selectParticipant(id: string): void {
    this.sequenceSelected = { kind: 'participant', id };
    this.dom.classList.add('mermaid-has-selection');
    this.renderedEl
      .querySelectorAll('.sequence-selected')
      .forEach((el) => el.classList.remove('sequence-selected'));
    // Highlight both the participant header AND the lifeline for the
    // same id — they represent the same actor.
    this.renderedEl.querySelectorAll(`[data-id="${id}"]`).forEach((el) => {
      const et = (el as HTMLElement).dataset.et;
      if (et === 'participant' || et === 'life-line') {
        el.classList.add('sequence-selected');
      }
    });
    // Mutual exclusivity: close every other popover (only one visible at
    // a time across diagram modes).
    this.closePopover();
    this.closeEdgePopover();
    this.closeMessagePopover();
    this.closeNotePopover();
    this.openParticipantPopover(id);
  }

  private selectMessage(index: number): void {
    this.sequenceSelected = { kind: 'message', index };
    this.dom.classList.add('mermaid-has-selection');
    this.renderedEl
      .querySelectorAll('.sequence-selected')
      .forEach((el) => el.classList.remove('sequence-selected'));
    this.renderedEl
      .querySelector(`[data-et="message"][data-id="i${index}"]`)
      ?.classList.add('sequence-selected');
    // Mutual exclusivity: close every other popover (only one visible at
    // a time across diagram modes).
    this.closePopover();
    this.closeEdgePopover();
    this.closeParticipantPopover();
    this.closeNotePopover();
    this.openMessagePopover(index);
  }

  private selectNote(index: number): void {
    this.sequenceSelected = { kind: 'note', index };
    this.dom.classList.add('mermaid-has-selection');
    this.renderedEl
      .querySelectorAll('.sequence-selected')
      .forEach((el) => el.classList.remove('sequence-selected'));
    this.renderedEl
      .querySelector(`g[data-et="note"][data-id="i${index}"]`)
      ?.classList.add('sequence-selected');
    // Mutual exclusivity: close every other popover (only one visible at
    // a time across diagram modes).
    this.closePopover();
    this.closeEdgePopover();
    this.closeParticipantPopover();
    this.closeMessagePopover();
    this.openNotePopover(index);
  }

  private clearSequenceSelection(): void {
    this.sequenceSelected = null;
    this.dom.classList.remove('mermaid-has-selection');
    this.renderedEl
      .querySelectorAll('.sequence-selected')
      .forEach((el) => el.classList.remove('sequence-selected'));
    this.closeParticipantPopover();
    this.closeMessagePopover();
    this.closeNotePopover();
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
    this.closeParticipantPopover();
    this.closeMessagePopover();
    this.closeNotePopover();
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
    if (this.participantPopoverInstance) {
      try {
        unmount(this.participantPopoverInstance);
      } catch {
        // Best-effort — if Svelte already cleaned up, ignore.
      }
      this.participantPopoverInstance = null;
    }
    if (this.messagePopoverInstance) {
      try {
        unmount(this.messagePopoverInstance);
      } catch {
        // Best-effort — if Svelte already cleaned up, ignore.
      }
      this.messagePopoverInstance = null;
    }
    if (this.notePopoverInstance) {
      try {
        unmount(this.notePopoverInstance);
      } catch {
        // Best-effort — if Svelte already cleaned up, ignore.
      }
      this.notePopoverInstance = null;
    }
    if (this.connectBannerInstance) {
      try {
        unmount(this.connectBannerInstance);
      } catch {
        // Best-effort — if Svelte already cleaned up, ignore.
      }
      this.connectBannerInstance = null;
    }
    if (this.sequenceActionsInstance) {
      try {
        unmount(this.sequenceActionsInstance);
      } catch {
        // Best-effort — if Svelte already cleaned up, ignore.
      }
      this.sequenceActionsInstance = null;
    }
  }

  private async renderFromNode(node: Node): Promise<void> {
    const seq = ++this.renderSeq;
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
      // Mutually exclusive with sequenceGraph — clear it when in
      // flowchart mode so stale state from a previous source can't
      // leak through diagram-type changes.
      this.sequenceGraph = null;
    } else if (type === 'sequence') {
      const parsed = parseSequence(source);
      if (parsed.ok) {
        this.sequenceGraph = parsed.graph;
        this.dom.classList.remove('mermaid-fallback');
      } else {
        this.sequenceGraph = null;
        this.dom.classList.add('mermaid-fallback');
      }
      // Not a flowchart — clear the flowchart graph so flowchart edit
      // handlers no-op and stale node/edge highlights don't reapply.
      this.graph = null;
    } else {
      // Unsupported diagram type (classDiagram, gantt, legacy `graph`,
      // etc.): render via mermaid as fallback, no editing.
      this.graph = null;
      this.sequenceGraph = null;
      this.dom.classList.add('mermaid-fallback');
    }

    // Empty diagram (e.g. fresh `flowchart TD\n` from the toolbar button):
    // skip the mermaid render and show a placeholder with a "+ Add first
    // shape" affordance instead. mermaid would render an empty SVG and
    // there's nothing for the user to click; the placeholder gives them
    // an entry point that opens the node popover for a brand-new node.
    if (flowchartParsed?.ok && flowchartParsed.graph.nodes.size === 0) {
      // Any popover/banner from a previous render would now be orphaned —
      // there are no SVG nodes left to anchor against. A pending select
      // can't target anything in an empty graph either (defensive —
      // add-element flows always commit a non-empty graph).
      this.pendingSelect = null;
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
      // Keep the action-bar hidden in flowchart empty-state.
      this.refreshActionsBar();
      return;
    }

    // Empty sequence diagram (e.g. fresh `sequenceDiagram\n` from the
    // toolbar): same idea as the flowchart placeholder above. Show a
    // "+ Add first participant" button instead of a participant-less
    // SVG (which mermaid renders as a near-empty sliver). The action-
    // bar stays hidden in this state too — the placeholder is the entry
    // point.
    if (
      type === 'sequence' &&
      this.sequenceGraph &&
      this.sequenceGraph.participants.size === 0
    ) {
      this.pendingSelect = null;
      this.clearSequenceSelection();
      this.renderedEl.innerHTML = '';
      const placeholder = document.createElement('button');
      placeholder.type = 'button';
      placeholder.className = 'mermaid-empty-state';
      placeholder.textContent = '+ Add first participant';
      placeholder.addEventListener('mousedown', (e) => e.preventDefault());
      placeholder.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleAddParticipant();
      });
      this.renderedEl.appendChild(placeholder);
      this.refreshActionsBar();
      return;
    }

    try {
      const mermaid = await getMermaid();
      const id = `remarkdown-mermaid-${++renderId}`;
      const { svg } = await mermaid.render(id, source);
      // A newer render started while this one was in flight — drop the
      // stale result instead of clobbering the fresh SVG.
      if (seq !== this.renderSeq) return;
      this.renderedEl.innerHTML = svg;
      // Mermaid draws edges as 1-2px paths whose hit-test area equals
      // the visible stroke — pixel-precise to click. Inject a wider
      // transparent sibling path for each edge so users have a forgiving
      // hit zone without changing the visual line. The click handler
      // already matches on data-id, so the wider target is picked up
      // automatically without further wiring.
      this.injectEdgeHitTargets();
      // A pending select (from an add-element flow) takes precedence
      // over restoring the previous selection — the user just created
      // this element and expects its popover. Stale pendings (element
      // missing, e.g. an undo landed in between) fall through to the
      // restore chain below.
      const pending = this.pendingSelect;
      this.pendingSelect = null;
      // After re-rendering the SVG, the previously-selected element no
      // longer exists. Re-apply the highlight + reposition the popover
      // against the new SVG element if a selection is still active.
      if (pending?.kind === 'node' && this.graph?.nodes.has(pending.id)) {
        this.selectGraphNode(pending.id);
      } else if (
        pending?.kind === 'participant' &&
        this.sequenceGraph?.participants.has(pending.id)
      ) {
        this.selectParticipant(pending.id);
      } else if (
        pending?.kind === 'message' &&
        this.sequenceGraph?.events[pending.index]?.kind === 'message'
      ) {
        this.selectMessage(pending.index);
      } else if (
        pending?.kind === 'note' &&
        this.sequenceGraph?.events[pending.index]?.kind === 'note'
      ) {
        this.selectNote(pending.index);
      } else if (this.selected?.kind === 'node' && this.graph?.nodes.has(this.selected.id)) {
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
      } else if (
        this.sequenceSelected?.kind === 'participant' &&
        this.sequenceGraph?.participants.has(this.sequenceSelected.id)
      ) {
        this.selectParticipant(this.sequenceSelected.id);
      } else if (this.sequenceSelected?.kind === 'participant') {
        this.clearSequenceSelection();
      } else if (this.sequenceSelected?.kind === 'message') {
        const idx = this.sequenceSelected.index;
        const ev = this.sequenceGraph?.events[idx];
        if (ev?.kind === 'message') {
          this.selectMessage(idx);
        } else {
          this.clearSequenceSelection();
        }
      } else if (this.sequenceSelected?.kind === 'note') {
        const idx = this.sequenceSelected.index;
        const ev = this.sequenceGraph?.events[idx];
        if (ev?.kind === 'note') {
          this.selectNote(idx);
        } else {
          this.clearSequenceSelection();
        }
      }
      // Refresh the action-bar AFTER the SVG paint so visibility +
      // canAddMessage track the latest participant count.
      this.refreshActionsBar();
    } catch (err) {
      // Same staleness rule as the success path: an error from a
      // superseded render must not paint over the newer result.
      if (seq !== this.renderSeq) return;
      this.pendingSelect = null;
      const msg = err instanceof Error ? err.message : String(err);
      this.renderedEl.innerHTML = '';
      const errBox = document.createElement('pre');
      errBox.className = 'mermaid-error';
      errBox.textContent = `Mermaid error: ${msg}`;
      this.renderedEl.appendChild(errBox);
      // Keep the action-bar hidden when mermaid threw — bare error text
      // means there's no diagram to add to.
      this.refreshActionsBar();
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
  // let renderFromNode open the popover via pendingSelect once the SVG
  // exists (it doesn't until mermaid finishes rendering, and the
  // popover anchors to that SVG element).
  private createFirstNode(): void {
    if (!this.graph) return;
    const result = addNode(this.graph, { shape: 'rect', label: '' });
    this.graph = result.graph;
    this.pendingSelect = { kind: 'node', id: result.id };
    this.commitGraphChange(serializeMermaid(this.graph));
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
    // Mermaid render is async — renderFromNode opens the popover for
    // the new node via pendingSelect once its SVG element exists
    // (opening earlier would position the popover at (0,0)).
    this.pendingSelect = { kind: 'node', id: result.id };
    this.commitGraphChange(serializeMermaid(g));
    this.exitConnectMode();
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

  // Participant popover lifecycle (Task 5). Mirrors openEdgePopover —
  // anchor against the participant's <g data-et="participant"> element
  // in WRAPPER coordinates (popover-host is absolute inside the wrapper,
  // not the editor-shell), seed display from the graph, and wire the
  // edit/delete callbacks back through setParticipantDisplay /
  // deleteParticipant + serializeSequence.
  private openParticipantPopover(id: string): void {
    if (!this.sequenceGraph) return;
    const participant = this.sequenceGraph.participants.get(id);
    if (!participant) return;
    const svgEl = this.renderedEl.querySelector(
      `g[data-et="participant"][data-id="${id}"]`,
    );
    let x = 0;
    let y = 0;
    if (
      svgEl &&
      typeof (svgEl as SVGGraphicsElement).getBoundingClientRect === 'function'
    ) {
      const rect = (svgEl as SVGGraphicsElement).getBoundingClientRect();
      const wrapperRect = this.dom.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      x = rect.right - wrapperRect.left + 8;
      y = rect.top - wrapperRect.top;
    }
    this.participantPopoverStore.set({
      visible: true,
      x,
      y,
      display: participant.display,
      onDisplayChange: (display) => this.handleParticipantDisplayChange(id, display),
      onDelete: () => this.handleDeleteParticipant(id),
      onClose: () => this.closeParticipantPopover(),
    });
  }

  private closeParticipantPopover(): void {
    this.participantPopoverStore.set({ ...HIDDEN_PARTICIPANT_POPOVER_STATE });
  }

  private handleParticipantDisplayChange(id: string, display: string): void {
    if (!this.sequenceGraph) return;
    const newGraph = setParticipantDisplay(this.sequenceGraph, id, display);
    this.sequenceGraph = newGraph;
    this.commitGraphChange(serializeSequence(newGraph));
  }

  private handleDeleteParticipant(id: string): void {
    if (!this.sequenceGraph) return;
    // deleteParticipant cascades to remove every event involving this
    // participant (messages from/to it, notes referencing it). The
    // serializer emits the resulting graph; PM round-trips through
    // commitGraphChange.
    const newGraph = deleteParticipant(this.sequenceGraph, id);
    this.sequenceGraph = newGraph;
    this.commitGraphChange(serializeSequence(newGraph));
    this.closeParticipantPopover();
    this.clearSequenceSelection();
  }

  // Message popover lifecycle (Task 6). Mirrors openEdgePopover —
  // anchor against the message arrow's `[data-et="message"][data-id="i<N>"]`
  // element at its midpoint (messages are horizontal arrows, so the
  // midpoint reads more naturally than a corner). Coords are in WRAPPER
  // space because the popover-host is absolute inside the wrapper.
  private openMessagePopover(index: number): void {
    if (!this.sequenceGraph) return;
    const ev = this.sequenceGraph.events[index];
    if (!ev || ev.kind !== 'message') {
      this.closeMessagePopover();
      return;
    }
    const svgEl = this.renderedEl.querySelector(
      `[data-et="message"][data-id="i${index}"]`,
    );
    let x = 0;
    let y = 0;
    if (
      svgEl &&
      typeof (svgEl as SVGGraphicsElement).getBoundingClientRect === 'function'
    ) {
      const rect = (svgEl as SVGGraphicsElement).getBoundingClientRect();
      const wrapperRect = this.dom.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      x = (rect.left + rect.right) / 2 - wrapperRect.left;
      y = (rect.top + rect.bottom) / 2 - wrapperRect.top;
    }
    this.messagePopoverStore.set({
      visible: true,
      x,
      y,
      text: ev.text,
      style: ev.style,
      onTextChange: (text) => this.handleMessageTextChange(index, text),
      onStyleChange: (style) => this.handleMessageStyleChange(index, style),
      onDelete: () => this.handleDeleteMessage(index),
      onAddAfter: () => this.handleAddMessageAfter(index),
      onClose: () => this.closeMessagePopover(),
    });
  }

  private closeMessagePopover(): void {
    this.messagePopoverStore.set({ ...HIDDEN_MESSAGE_POPOVER_STATE });
  }

  private handleMessageTextChange(index: number, text: string): void {
    if (!this.sequenceGraph) return;
    const newGraph = setMessageText(this.sequenceGraph, index, text);
    this.sequenceGraph = newGraph;
    this.commitGraphChange(serializeSequence(newGraph));
  }

  private handleMessageStyleChange(index: number, style: MessageStyle): void {
    if (!this.sequenceGraph) return;
    const newGraph = setMessageStyle(this.sequenceGraph, index, style);
    this.sequenceGraph = newGraph;
    this.commitGraphChange(serializeSequence(newGraph));
  }

  private handleDeleteMessage(index: number): void {
    if (!this.sequenceGraph) return;
    const newGraph = deleteMessage(this.sequenceGraph, index);
    this.sequenceGraph = newGraph;
    this.commitGraphChange(serializeSequence(newGraph));
    this.closeMessagePopover();
    // Selection is now stale — clear it so the post-render selection
    // restore (in renderFromNode) doesn't try to re-highlight a deleted
    // event index.
    this.sequenceSelected = null;
    this.dom.classList.remove('mermaid-has-selection');
  }

  // Note popover lifecycle (Task 7 of Phase 2g). Mirrors openMessagePopover —
  // anchor against the note rect's `g[data-et="note"][data-id="i<N>"]`
  // element. Position the popover to the right of the note (left/top of
  // the note's bounding rect) in WRAPPER coords, matching the participant-
  // popover convention.
  private openNotePopover(index: number): void {
    if (!this.sequenceGraph) return;
    const ev = this.sequenceGraph.events[index];
    if (!ev || ev.kind !== 'note') {
      this.closeNotePopover();
      return;
    }
    const svgEl = this.renderedEl.querySelector(
      `g[data-et="note"][data-id="i${index}"]`,
    );
    let x = 0;
    let y = 0;
    if (
      svgEl &&
      typeof (svgEl as SVGGraphicsElement).getBoundingClientRect === 'function'
    ) {
      const rect = (svgEl as SVGGraphicsElement).getBoundingClientRect();
      const wrapperRect = this.dom.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      x = rect.right - wrapperRect.left + 8;
      y = rect.top - wrapperRect.top;
    }
    const primary = ev.participants[0] ?? '';
    const secondary = ev.participants[1] ?? '';
    const available = Array.from(this.sequenceGraph.participants.keys());
    this.notePopoverStore.set({
      visible: true,
      x,
      y,
      text: ev.text,
      position: ev.position,
      primaryParticipant: primary,
      secondaryParticipant: secondary,
      availableParticipants: available,
      onTextChange: (text) => this.handleNoteTextChange(index, text),
      onPositionChange: (position) => this.handleNotePositionChange(index, position),
      onSecondaryChange: (secondaryId) =>
        this.handleNoteSecondaryChange(index, secondaryId),
      onDelete: () => this.handleDeleteNote(index),
      onClose: () => this.closeNotePopover(),
    });
  }

  private closeNotePopover(): void {
    this.notePopoverStore.set({ ...HIDDEN_NOTE_POPOVER_STATE });
  }

  private handleNoteTextChange(index: number, text: string): void {
    if (!this.sequenceGraph) return;
    const newGraph = setNoteText(this.sequenceGraph, index, text);
    this.sequenceGraph = newGraph;
    this.commitGraphChange(serializeSequence(newGraph));
  }

  private handleNotePositionChange(index: number, position: NotePosition): void {
    if (!this.sequenceGraph) return;
    const ev = this.sequenceGraph.events[index];
    if (!ev || ev.kind !== 'note') return;
    // leftOf / rightOf only allow ONE participant — truncate if the
    // note was previously `over A,B`. For 'over' itself, keep the
    // existing participants array intact (the secondary <select>
    // controls additions/removals separately).
    const participants =
      position === 'over'
        ? ev.participants
        : ev.participants.slice(0, 1);
    const newGraph = setNotePosition(this.sequenceGraph, index, {
      participants,
      position,
    });
    this.sequenceGraph = newGraph;
    this.commitGraphChange(serializeSequence(newGraph));
  }

  private handleNoteSecondaryChange(index: number, secondaryId: string): void {
    if (!this.sequenceGraph) return;
    const ev = this.sequenceGraph.events[index];
    if (!ev || ev.kind !== 'note') return;
    const primary = ev.participants[0] ?? '';
    if (!primary) return;
    const participants = secondaryId ? [primary, secondaryId] : [primary];
    const newGraph = setNotePosition(this.sequenceGraph, index, {
      participants,
      position: 'over',
    });
    this.sequenceGraph = newGraph;
    this.commitGraphChange(serializeSequence(newGraph));
  }

  private handleDeleteNote(index: number): void {
    if (!this.sequenceGraph) return;
    const newGraph = deleteNote(this.sequenceGraph, index);
    this.sequenceGraph = newGraph;
    this.commitGraphChange(serializeSequence(newGraph));
    this.closeNotePopover();
    // Selection is now stale — clear it so the post-render selection
    // restore (in renderFromNode) doesn't try to re-highlight a deleted
    // event index.
    this.sequenceSelected = null;
    this.dom.classList.remove('mermaid-has-selection');
  }

  // Add-element handlers for sequence diagrams (Task 8 of Phase 2g).
  // Mirrors the flowchart `createFirstNode` / `addNewNodeInConnectMode`
  // pattern: mutate the graph, stash a pendingSelect, commit through
  // PM. renderFromNode opens the popover once mermaid has re-rendered
  // and the new SVG element exists to anchor against.

  // Refresh the action-bar state from the current sequenceGraph. Called
  // at the end of every sequence render. The bar is hidden in the
  // empty-state (the placeholder serves the entry point), in flowchart
  // mode, and in unsupported / fallback mode.
  private refreshActionsBar(): void {
    if (this.diagramType !== 'sequence' || !this.sequenceGraph) {
      this.sequenceActionsStore.set({ ...HIDDEN_ACTIONS_STATE });
      return;
    }
    const pCount = this.sequenceGraph.participants.size;
    this.sequenceActionsStore.set({
      visible: pCount > 0, // hidden in empty-state — the placeholder owns that
      canAddParticipant: true,
      canAddMessage: pCount >= 2,
      canAddNote: pCount >= 1,
      onAddParticipant: () => this.handleAddParticipant(),
      onAddMessage: () => this.enterAddMessageMode(),
      onAddNote: () => this.handleAddNote(),
    });
  }

  // One-click: add an empty-display participant, then open its popover
  // so the user types a display name immediately. The id-generation in
  // mermaid-sequence-graph picks A, B, C, ... so the new id is fresh.
  private handleAddParticipant(): void {
    if (!this.sequenceGraph) return;
    const result = addParticipant(this.sequenceGraph, { display: '' });
    this.sequenceGraph = result.graph;
    this.pendingSelect = { kind: 'participant', id: result.id };
    this.commitGraphChange(serializeSequence(this.sequenceGraph));
  }

  // One-click: add a leftOf-positioned note on the first participant
  // with empty text, then open its popover so the user can edit the
  // text / position / second participant.
  private handleAddNote(): void {
    if (!this.sequenceGraph) return;
    const firstId = Array.from(this.sequenceGraph.participants.keys())[0];
    if (!firstId) return;
    // The new note will be appended (addNote pushes onto events), so
    // its index is the current length.
    const newIndex = this.sequenceGraph.events.length;
    const newGraph = addNote(this.sequenceGraph, {
      participants: [firstId],
      position: 'leftOf',
      text: '',
    });
    this.sequenceGraph = newGraph;
    this.pendingSelect = { kind: 'note', index: newIndex };
    this.commitGraphChange(serializeSequence(newGraph));
  }

  // Two-step: enter add-message mode. The next click on a participant
  // header records FROM; the click after that records TO and commits a
  // new message. Esc / empty-area click cancels. Reuses the connect-
  // banner store for visual feedback (a slight semantic stretch — the
  // banner copy "Click a node to connect" is generic enough for now).
  private enterAddMessageMode(): void {
    if (!this.sequenceGraph) return;
    this.addMessageMode = { from: null };
    this.dom.classList.add('mermaid-add-message-mode');
    // Mutually exclusive with every popover.
    this.closePopover();
    this.closeEdgePopover();
    this.closeParticipantPopover();
    this.closeMessagePopover();
    this.closeNotePopover();
    this.connectBannerStore.set({
      visible: true,
      onAddNewNode: () => {
        // Not applicable in sequence add-message mode — the banner's
        // "+ Add new node" button would need its own copy/UX. For now
        // make it a no-op.
      },
      onCancel: () => this.exitAddMessageMode(),
    });
    this.escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.addMessageMode) {
        e.preventDefault();
        this.exitAddMessageMode();
      }
    };
    document.addEventListener('keydown', this.escListener);
  }

  private exitAddMessageMode(): void {
    this.addMessageMode = null;
    this.dom.classList.remove('mermaid-add-message-mode');
    this.connectBannerStore.set({ ...HIDDEN_BANNER_STATE });
    // Clear any "pending FROM" highlight from the SVG.
    this.renderedEl
      .querySelectorAll('.sequence-pending-from')
      .forEach((el) => el.classList.remove('sequence-pending-from'));
    if (this.escListener) {
      document.removeEventListener('keydown', this.escListener);
      this.escListener = null;
    }
  }

  // "+ after" entry point on the message popover. Inserts a new message
  // at index+1 (right below the current one) with the SAME from/to/style
  // and empty text, so the user only has to type the text. Open the new
  // popover after re-render.
  private handleAddMessageAfter(index: number): void {
    if (!this.sequenceGraph) return;
    const ev = this.sequenceGraph.events[index];
    if (!ev || ev.kind !== 'message') return;
    const events = [...this.sequenceGraph.events];
    events.splice(index + 1, 0, {
      kind: 'message',
      from: ev.from,
      to: ev.to,
      text: '',
      style: ev.style,
    });
    this.sequenceGraph = { ...this.sequenceGraph, events };
    this.pendingSelect = { kind: 'message', index: index + 1 };
    this.commitGraphChange(serializeSequence(this.sequenceGraph));
  }
}
