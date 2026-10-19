// Sequence-diagram editing (see controller.ts for the contract).
// Participants, messages and notes open their popovers on click; the
// floating action bar adds participants / messages / notes. Edits go
// through mermaid-sequence-edit.ts, which only rewrites the lines an
// edit is about.
import MermaidParticipantPopover from '../../../components/MermaidParticipantPopover.svelte';
import MermaidMessagePopover from '../../../components/MermaidMessagePopover.svelte';
import MermaidNotePopover from '../../../components/MermaidNotePopover.svelte';
import MermaidSequenceActions from '../../../components/MermaidSequenceActions.svelte';
import MermaidConnectBanner from '../../../components/MermaidConnectBanner.svelte';
import { parseSequence } from '../mermaid-sequence-parser';
import type { SequenceGraph, MessageStyle, NotePosition } from '../mermaid-sequence-graph';
import { applySequenceEdit, type SequenceEdit, type SequenceEditResult } from '../mermaid-sequence-edit';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';
import { HIDDEN_BANNER, type BannerState } from './flowchart-controller';

type Selection =
  | { kind: 'participant'; id: string }
  | { kind: 'message'; index: number }
  | { kind: 'note'; index: number }
  | null;

interface ParticipantPopoverState {
  visible: boolean;
  x: number;
  y: number;
  display: string;
  onDisplayChange: (display: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

const HIDDEN_PARTICIPANT: ParticipantPopoverState = {
  visible: false,
  x: 0,
  y: 0,
  display: '',
  onDisplayChange: () => {},
  onDelete: () => {},
  onClose: () => {},
};

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

const HIDDEN_MESSAGE: MessagePopoverState = {
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

const HIDDEN_NOTE: NotePopoverState = {
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

interface ActionsState {
  visible: boolean;
  canAddParticipant: boolean;
  canAddMessage: boolean;
  canAddNote: boolean;
  onAddParticipant: () => void;
  onAddMessage: () => void;
  onAddNote: () => void;
}

const HIDDEN_ACTIONS: ActionsState = {
  visible: false,
  canAddParticipant: false,
  canAddMessage: false,
  canAddNote: false,
  onAddParticipant: () => {},
  onAddMessage: () => {},
  onAddNote: () => {},
};

export class SequenceController implements DiagramController {
  private host: DiagramHost;
  private graph: SequenceGraph | null = null;
  private selected: Selection = null;
  // See FlowchartController.pendingSelect.
  private pendingSelect: Exclude<Selection, null> | null = null;
  // Add-message mode: the first participant click records FROM, the
  // second records TO and adds the message.
  private addMessageMode: { from: string | null } | null = null;
  private participantPopover: MountedUi<ParticipantPopoverState>;
  private messagePopover: MountedUi<MessagePopoverState>;
  private notePopover: MountedUi<NotePopoverState>;
  private actions: MountedUi<ActionsState>;
  private banner: MountedUi<BannerState>;

  constructor(host: DiagramHost) {
    this.host = host;
    this.participantPopover = mountUi(
      host,
      MermaidParticipantPopover,
      'mermaid-popover-host mermaid-participant-popover-host',
      HIDDEN_PARTICIPANT,
    );
    this.messagePopover = mountUi(host, MermaidMessagePopover, 'mermaid-popover-host mermaid-message-popover-host', HIDDEN_MESSAGE);
    this.notePopover = mountUi(host, MermaidNotePopover, 'mermaid-popover-host mermaid-note-popover-host', HIDDEN_NOTE);
    this.banner = mountUi(host, MermaidConnectBanner, 'mermaid-popover-host mermaid-connect-banner-host', HIDDEN_BANNER);
    this.actions = mountUi(host, MermaidSequenceActions, 'mermaid-popover-host mermaid-sequence-actions-host', HIDDEN_ACTIONS);
  }

  load(source: string): boolean {
    const parsed = parseSequence(source);
    this.graph = parsed.ok ? parsed.graph : null;
    return parsed.ok;
  }

  // A participant-less sequence renders as a near-empty sliver; offer
  // "+ Add first participant" instead.
  emptyState(): EmptyState | null {
    if (!this.graph || this.graph.participants.size > 0) return null;
    return { label: '+ Add first participant', onActivate: () => this.addParticipant() };
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
    if (this.addMessageMode && this.graph) return this.pickForMessage(target);
    // mermaid's sequence renderer tags every clickable element with
    // `data-et` (+ `data-id`):
    //   g[data-et="participant"] / line[data-et="life-line"]  → id
    //   [data-et="message"] / g[data-et="note"]               → i<N>
    // i<N> is the event's index in mermaid's message list; with the
    // subset parsed here (messages and notes only) that is the index
    // into graph.events.
    const participant = target.closest('g[data-et="participant"], line[data-et="life-line"]') as HTMLElement | null;
    if (participant) {
      const id = participant.dataset.id ?? '';
      if (id && this.graph?.participants.has(id)) {
        this.select({ kind: 'participant', id });
        return true;
      }
    }
    for (const kind of ['message', 'note'] as const) {
      const el = target.closest(kind === 'message' ? '[data-et="message"]' : 'g[data-et="note"]') as HTMLElement | null;
      const m = el ? /^i(\d+)$/.exec(el.dataset.id ?? '') : null;
      if (m) {
        const index = Number.parseInt(m[1], 10);
        if (this.graph?.events[index]?.kind === kind) {
          this.select({ kind, index });
          return true;
        }
      }
    }
    this.clearSelection();
    return false;
  }

  destroy(): void {
    this.exitAddMessageMode();
    this.participantPopover.destroy();
    this.messagePopover.destroy();
    this.notePopover.destroy();
    this.banner.destroy();
    this.actions.destroy();
  }

  // ── selection ──────────────────────────────────────────────────────

  private exists(sel: Exclude<Selection, null>): boolean {
    if (!this.graph) return false;
    if (sel.kind === 'participant') return this.graph.participants.has(sel.id);
    return this.graph.events[sel.index]?.kind === sel.kind;
  }

  private select(sel: Exclude<Selection, null>): void {
    this.selected = sel;
    this.host.dom.classList.add('mermaid-has-selection');
    const rendered = this.host.renderedEl;
    rendered.querySelectorAll('.sequence-selected').forEach((el) => el.classList.remove('sequence-selected'));
    this.hidePopovers();
    if (sel.kind === 'participant') {
      // The header and the lifeline are the same actor.
      rendered.querySelectorAll(`[data-id="${sel.id}"]`).forEach((el) => {
        const et = (el as HTMLElement).dataset.et;
        if (et === 'participant' || et === 'life-line') el.classList.add('sequence-selected');
      });
      this.openParticipantPopover(sel.id);
    } else if (sel.kind === 'message') {
      rendered.querySelector(`[data-et="message"][data-id="i${sel.index}"]`)?.classList.add('sequence-selected');
      this.openMessagePopover(sel.index);
    } else {
      rendered.querySelector(`g[data-et="note"][data-id="i${sel.index}"]`)?.classList.add('sequence-selected');
      this.openNotePopover(sel.index);
    }
  }

  private clearSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.host.renderedEl
      .querySelectorAll('.sequence-selected')
      .forEach((el) => el.classList.remove('sequence-selected'));
    this.hidePopovers();
  }

  private hidePopovers(): void {
    this.participantPopover.hide();
    this.messagePopover.hide();
    this.notePopover.hide();
  }

  // Deletes make the selection stale — drop it BEFORE committing so the
  // post-render restore (synchronous on a cache hit) doesn't highlight
  // whatever now sits at that index.
  private dropSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.hidePopovers();
  }

  // ── popovers ───────────────────────────────────────────────────────

  private openParticipantPopover(id: string): void {
    const participant = this.graph?.participants.get(id);
    if (!participant) return;
    const svgEl = this.host.renderedEl.querySelector(`g[data-et="participant"][data-id="${id}"]`);
    const { x, y } = this.host.anchor(svgEl, 'right');
    this.participantPopover.show({
      visible: true,
      x,
      y,
      display: participant.display,
      onDisplayChange: (display) => this.commit({ kind: 'setParticipantDisplay', id, display }),
      onDelete: () => {
        // Cascades: every event involving this participant goes too.
        this.commit({ kind: 'deleteParticipant', id });
        this.clearSelection();
      },
      onClose: () => this.participantPopover.hide(),
    });
  }

  private openMessagePopover(index: number): void {
    const ev = this.graph?.events[index];
    if (!ev || ev.kind !== 'message') {
      this.messagePopover.hide();
      return;
    }
    const svgEl = this.host.renderedEl.querySelector(`[data-et="message"][data-id="i${index}"]`);
    const { x, y } = this.host.anchor(svgEl, 'center');
    this.messagePopover.show({
      visible: true,
      x,
      y,
      text: ev.text,
      style: ev.style,
      onTextChange: (text) => this.commit({ kind: 'setMessageText', index, text }),
      onStyleChange: (style) => this.commit({ kind: 'setMessageStyle', index, style }),
      onDelete: () => {
        this.dropSelection();
        this.commit({ kind: 'deleteMessage', index });
      },
      // "+ after": same from/to/style right below, so only the text is
      // left to type.
      onAddAfter: () =>
        this.commit(
          { kind: 'addMessage', from: ev.from, to: ev.to, text: '', style: ev.style, afterIndex: index },
          (r) => {
            if (r.index !== undefined) this.pendingSelect = { kind: 'message', index: r.index };
          },
        ),
      onClose: () => this.messagePopover.hide(),
    });
  }

  private openNotePopover(index: number): void {
    const ev = this.graph?.events[index];
    if (!this.graph || !ev || ev.kind !== 'note') {
      this.notePopover.hide();
      return;
    }
    const svgEl = this.host.renderedEl.querySelector(`g[data-et="note"][data-id="i${index}"]`);
    const { x, y } = this.host.anchor(svgEl, 'right');
    this.notePopover.show({
      visible: true,
      x,
      y,
      text: ev.text,
      position: ev.position,
      primaryParticipant: ev.participants[0] ?? '',
      secondaryParticipant: ev.participants[1] ?? '',
      availableParticipants: Array.from(this.graph.participants.keys()),
      onTextChange: (text) => this.commit({ kind: 'setNoteText', index, text }),
      // leftOf / rightOf take ONE participant — truncate an `over A,B`
      // note; 'over' keeps what it has (the second-participant picker
      // adds / removes separately).
      onPositionChange: (position) =>
        this.commit({
          kind: 'setNotePosition',
          index,
          participants: position === 'over' ? ev.participants : ev.participants.slice(0, 1),
          position,
        }),
      onSecondaryChange: (secondaryId) => {
        const primary = ev.participants[0] ?? '';
        if (!primary) return;
        this.commit({
          kind: 'setNotePosition',
          index,
          participants: secondaryId ? [primary, secondaryId] : [primary],
          position: 'over',
        });
      },
      onDelete: () => {
        this.dropSelection();
        this.commit({ kind: 'deleteNote', index });
      },
      onClose: () => this.notePopover.hide(),
    });
  }

  private refreshActions(): void {
    if (!this.graph) {
      this.actions.hide();
      return;
    }
    const count = this.graph.participants.size;
    this.actions.show({
      visible: count > 0, // the empty-state placeholder owns the empty case
      canAddParticipant: true,
      canAddMessage: count >= 2,
      canAddNote: count >= 1,
      onAddParticipant: () => this.addParticipant(),
      onAddMessage: () => this.enterAddMessageMode(),
      onAddNote: () => this.addNote(),
    });
  }

  // ── edits ──────────────────────────────────────────────────────────

  private commit(edit: SequenceEdit, beforeCommit?: (result: SequenceEditResult) => void): void {
    if (!this.graph) return;
    const source = this.host.source();
    if (source == null) return;
    const result = applySequenceEdit(source, edit);
    if (!result) return;
    beforeCommit?.(result);
    this.host.commit(result.source);
  }

  // A fresh participant (next free id), popover open so the name can be
  // typed right away.
  private addParticipant(): void {
    this.commit({ kind: 'addParticipant', display: '' }, (r) => {
      if (r.id) this.pendingSelect = { kind: 'participant', id: r.id };
    });
  }

  private addNote(): void {
    const firstId = this.graph ? Array.from(this.graph.participants.keys())[0] : undefined;
    if (!firstId) return;
    this.commit({ kind: 'addNote', participants: [firstId], position: 'leftOf', text: '' }, (r) => {
      if (r.index !== undefined) this.pendingSelect = { kind: 'note', index: r.index };
    });
  }

  // ── add-message mode ───────────────────────────────────────────────

  private enterAddMessageMode(): void {
    if (!this.graph) return;
    this.addMessageMode = { from: null };
    this.host.dom.classList.add('mermaid-add-message-mode');
    this.clearSelection();
    this.banner.show({
      visible: true,
      hint: 'Click who sends the message, then who receives it',
      addLabel: null,
      onAddNewNode: () => {},
      onCancel: () => this.exitAddMessageMode(),
    });
    this.host.setEscapeHandler(() => this.exitAddMessageMode());
  }

  private exitAddMessageMode(): void {
    if (!this.addMessageMode) return;
    this.addMessageMode = null;
    this.host.dom.classList.remove('mermaid-add-message-mode');
    this.banner.hide();
    this.host.renderedEl
      .querySelectorAll('.sequence-pending-from')
      .forEach((el) => el.classList.remove('sequence-pending-from'));
    this.host.setEscapeHandler(null);
  }

  private pickForMessage(target: Element): boolean {
    const el = target.closest('g[data-et="participant"]') as HTMLElement | null;
    const id = el?.dataset.id ?? '';
    if (!el || !id || !this.graph?.participants.has(id) || !this.addMessageMode) {
      // Empty-area click: cancel.
      this.exitAddMessageMode();
      return true;
    }
    if (this.addMessageMode.from === null) {
      this.addMessageMode = { from: id };
      this.host.renderedEl
        .querySelectorAll('.sequence-pending-from')
        .forEach((x) => x.classList.remove('sequence-pending-from'));
      el.classList.add('sequence-pending-from');
      return true;
    }
    // Same participant twice: stay in the mode so another can be picked.
    if (id === this.addMessageMode.from) return true;
    const from = this.addMessageMode.from;
    this.commit({ kind: 'addMessage', from, to: id, text: '', style: 'arrow' }, (r) => {
      if (r.index !== undefined) this.pendingSelect = { kind: 'message', index: r.index };
    });
    this.exitAddMessageMode();
    return true;
  }
}
