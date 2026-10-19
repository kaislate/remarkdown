// Sequence-diagram editing (see controller.ts for the contract).
// Participants, messages, notes, blocks (loop / alt / …) and boxes open
// their popovers on click; shift-click extends a run of messages to put
// in a block together; the floating toolbar adds participants /
// messages / notes and switches numbering and the title. Edits go
// through mermaid-sequence-edit.ts, which only rewrites the lines an
// edit is about.
import MermaidParticipantPopover from '../../../components/MermaidParticipantPopover.svelte';
import MermaidMessagePopover from '../../../components/MermaidMessagePopover.svelte';
import MermaidNotePopover from '../../../components/MermaidNotePopover.svelte';
import MermaidActionsBar from '../../../components/MermaidActionsBar.svelte';
import MermaidConnectBanner from '../../../components/MermaidConnectBanner.svelte';
import MermaidFormPopover from '../../../components/MermaidFormPopover.svelte';
import { parseSequenceSource, type SequenceSourceMap } from '../mermaid-sequence-parser';
import type { BlockKind, MessageStyle, NotePosition, SequenceGraph } from '../mermaid-sequence-graph';
import { applySequenceEdit, type SequenceEdit, type SequenceEditResult } from '../mermaid-sequence-edit';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';
import { HIDDEN_BANNER, type BannerState } from './flowchart-controller';
import { FILL_PALETTE, HIDDEN_BAR, HIDDEN_FORM, type ActionsBarState, type ChoiceOption, type FormField, type FormPopoverState } from './form';

type PickableStyle = Exclude<MessageStyle, 'other'>;

type Selection =
  | { kind: 'participant'; id: string }
  // A message; `to` extends a shift-clicked run [index, to].
  | { kind: 'message'; index: number; to?: number }
  | { kind: 'note'; index: number }
  | { kind: 'block'; index: number }
  | { kind: 'box'; index: number }
  | { kind: 'title' }
  | null;

interface ParticipantPopoverState {
  visible: boolean;
  x: number;
  y: number;
  display: string;
  kind?: 'participant' | 'actor';
  boxLabel?: string | null;
  onDisplayChange: (display: string) => void;
  onKindChange?: (kind: 'participant' | 'actor') => void;
  onEditBox?: () => void;
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
  activation?: 'activate' | 'deactivate' | null;
  canDeactivate?: boolean;
  blockLabel?: string | null;
  onTextChange: (text: string) => void;
  onStyleChange: (style: PickableStyle) => void;
  onActivationChange?: (activation: 'activate' | 'deactivate' | null) => void;
  onWrap?: (kind: BlockKind) => void;
  onEditBlock?: () => void;
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

const BLOCK_NAMES: Record<BlockKind, string> = {
  loop: 'Repeat (loop)',
  alt: 'Either / or',
  opt: 'Optional',
  par: 'At the same time',
  critical: 'Critical',
  break: 'Stop here (break)',
  rect: 'Highlight',
};

// What a branch after the first is called, per block kind.
const BRANCH_NAMES: Partial<Record<BlockKind, string>> = { alt: 'Otherwise', par: 'Also at the same time', critical: 'Option' };

// Fills for a highlight block, light enough that the messages over them
// stay readable in both themes.
const HIGHLIGHTS = ['rgba(253, 230, 138, 0.35)', 'rgba(191, 219, 254, 0.35)', 'rgba(187, 247, 208, 0.35)', 'rgba(254, 202, 202, 0.35)', 'rgba(233, 213, 255, 0.35)'];

export class SequenceController implements DiagramController {
  private host: DiagramHost;
  private graph: SequenceGraph | null = null;
  private map: SequenceSourceMap | null = null;
  private selected: Selection = null;
  // See FlowchartController.pendingSelect.
  private pendingSelect: Exclude<Selection, null> | null = null;
  // Add-message mode: the first participant click records FROM, the
  // second records TO and adds the message.
  private addMessageMode: { from: string | null } | null = null;
  private participantPopover: MountedUi<ParticipantPopoverState>;
  private messagePopover: MountedUi<MessagePopoverState>;
  private notePopover: MountedUi<NotePopoverState>;
  private form: MountedUi<FormPopoverState>;
  private actions: MountedUi<ActionsBarState>;
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
    this.form = mountUi(host, MermaidFormPopover, 'mermaid-popover-host mermaid-form-popover-host', HIDDEN_FORM);
    this.banner = mountUi(host, MermaidConnectBanner, 'mermaid-popover-host mermaid-connect-banner-host', HIDDEN_BANNER);
    this.actions = mountUi(host, MermaidActionsBar, 'mermaid-popover-host mermaid-actions-host', HIDDEN_BAR);
  }

  load(source: string): boolean {
    const parsed = parseSequenceSource(source);
    this.graph = parsed.ok ? parsed.graph : null;
    this.map = parsed.ok ? parsed.map : null;
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

  click(target: Element, event?: MouseEvent): boolean {
    if (this.addMessageMode && this.graph) return this.pickForMessage(target);
    const hit = this.hitTest(target);
    if (!hit) {
      this.clearSelection();
      return false;
    }
    // Shift-click on a message extends the run of selected messages
    // (one level of one block, so the run can be put in a block).
    if (hit.kind === 'message' && event?.shiftKey && this.selected?.kind === 'message') {
      this.select({ kind: 'message', index: this.selected.index, to: hit.index });
      return true;
    }
    this.select(hit);
    return true;
  }

  destroy(): void {
    this.exitAddMessageMode();
    this.participantPopover.destroy();
    this.messagePopover.destroy();
    this.notePopover.destroy();
    this.form.destroy();
    this.banner.destroy();
    this.actions.destroy();
  }

  // ── hit testing ────────────────────────────────────────────────────

  // mermaid's sequence renderer tags clickable elements with `data-et`
  // (+ `data-id`):
  //   g[data-et="participant"] / line[data-et="life-line"]   → id
  //   [data-et="message"] / g[data-et="note"]                → i<N>
  //   g[data-et="control-structure"]                         → i<N>
  // where N is the position in mermaid's own message list — which also
  // counts activations, block openings / branches / ends and
  // `autonumber`, so it is resolved through the source map. A block is
  // named after its `end`. Boxes and highlight (rect) blocks carry no
  // tags; boxes are found by their drawn label.
  private hitTest(target: Element): Exclude<Selection, null | { kind: 'title' }> | null {
    const graph = this.graph;
    const map = this.map;
    if (!graph || !map) return null;
    const participant = target.closest('g[data-et="participant"], line[data-et="life-line"]') as HTMLElement | null;
    if (participant) {
      const id = participant.dataset.id ?? '';
      if (graph.participants.has(id)) return { kind: 'participant', id };
    }
    const tagged = target.closest('[data-et="message"], g[data-et="note"], g[data-et="control-structure"]') as HTMLElement | null;
    const m = tagged ? /^i(\d+)$/.exec(tagged.dataset.id ?? '') : null;
    if (tagged && m) {
      const n = Number.parseInt(m[1], 10);
      if (tagged.dataset.et === 'control-structure') {
        const index = map.blocks.findIndex((b) => b.endIndex === n);
        if (index !== -1) return { kind: 'block', index };
      } else {
        const index = map.events.findIndex((e) => e.mermaidIndex === n);
        const want = tagged.dataset.et === 'note' ? 'note' : 'message';
        if (index !== -1 && graph.events[index].kind === want) return { kind: want, index };
      }
    }
    const box = this.boxIndexOf(target);
    if (box !== null) return { kind: 'box', index: box };
    return null;
  }

  // Box groups: an untagged <g> holding a `rect.rect` and a `text.text`,
  // drawn last-first. Matched by label when that's unambiguous, else by
  // position.
  private boxGroups(): Element[] {
    const svg = this.host.renderedEl.querySelector('svg');
    if (!svg) return [];
    return Array.from(svg.querySelectorAll(':scope > g')).filter(
      (g) => !g.hasAttribute('data-et') && g.querySelector(':scope > rect.rect') && g.querySelector(':scope > text.text'),
    );
  }

  private boxIndexOf(target: Element): number | null {
    const graph = this.graph;
    if (!graph?.boxes.length) return null;
    const groups = this.boxGroups();
    const g = groups.find((x) => x.contains(target));
    if (!g) return null;
    const text = g.querySelector('text.text')?.textContent?.trim() ?? '';
    const byLabel = graph.boxes.map((b, i) => (b.label === text ? i : -1)).filter((i) => i !== -1);
    if (byLabel.length === 1) return byLabel[0];
    if (groups.length !== graph.boxes.length) return null;
    return graph.boxes.length - 1 - groups.indexOf(g);
  }

  private boxElement(index: number): Element | null {
    const graph = this.graph;
    if (!graph) return null;
    const groups = this.boxGroups();
    return groups.find((g) => this.boxIndexOf(g.querySelector('rect') ?? g) === index) ?? null;
  }

  private eventElement(index: number): Element | null {
    const src = this.map?.events[index];
    if (!src) return null;
    const sel = src.kind === 'note' ? 'g[data-et="note"]' : '[data-et="message"]';
    return this.host.renderedEl.querySelector(`${sel}[data-id="i${src.mermaidIndex}"]`);
  }

  private blockElement(index: number): Element | null {
    const src = this.map?.blocks[index];
    if (!src) return null;
    return this.host.renderedEl.querySelector(`g[data-et="control-structure"][data-id="i${src.endIndex}"]`);
  }

  // ── selection ──────────────────────────────────────────────────────

  private exists(sel: Exclude<Selection, null>): boolean {
    const graph = this.graph;
    if (!graph) return false;
    switch (sel.kind) {
      case 'participant':
        return graph.participants.has(sel.id);
      case 'message':
      case 'note':
        return graph.events[sel.index]?.kind === sel.kind && (sel.kind !== 'message' || sel.to === undefined || graph.events[sel.to]?.kind === 'message');
      case 'block':
        return !!graph.blocks[sel.index];
      case 'box':
        return !!graph.boxes[sel.index];
      default:
        return true;
    }
  }

  private select(sel: Exclude<Selection, null>): void {
    this.selected = sel;
    this.host.dom.classList.add('mermaid-has-selection');
    const rendered = this.host.renderedEl;
    rendered.querySelectorAll('.sequence-selected').forEach((el) => el.classList.remove('sequence-selected'));
    this.hidePopovers();
    switch (sel.kind) {
      case 'participant':
        // The header and the lifeline are the same actor.
        rendered.querySelectorAll(`[data-id="${CSS.escape(sel.id)}"]`).forEach((el) => {
          const et = (el as HTMLElement).dataset.et;
          if (et === 'participant' || et === 'life-line') el.classList.add('sequence-selected');
        });
        this.openParticipantPopover(sel.id);
        break;
      case 'message': {
        const [lo, hi] = this.run(sel);
        for (let i = lo; i <= hi; i++) if (this.graph?.events[i]?.kind === 'message') this.eventElement(i)?.classList.add('sequence-selected');
        this.openMessagePopover(sel.to ?? sel.index);
        break;
      }
      case 'note':
        this.eventElement(sel.index)?.classList.add('sequence-selected');
        this.openNotePopover(sel.index);
        break;
      case 'block':
        this.blockElement(sel.index)?.classList.add('sequence-selected');
        this.openBlockPopover(sel.index);
        break;
      case 'box':
        this.boxElement(sel.index)?.classList.add('sequence-selected');
        this.openBoxPopover(sel.index);
        break;
      case 'title':
        this.openTitlePopover();
        break;
    }
  }

  private run(sel: { index: number; to?: number }): [number, number] {
    const to = sel.to ?? sel.index;
    return [Math.min(sel.index, to), Math.max(sel.index, to)];
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
    this.form.hide();
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
    const graph = this.graph;
    const participant = graph?.participants.get(id);
    if (!graph || !participant) return;
    const svgEl = this.host.renderedEl.querySelector(`[data-et="participant"][data-id="${CSS.escape(id)}"]`);
    const { x, y } = this.host.anchor(svgEl, 'right');
    const box = graph.boxes.findIndex((b) => b.participants.includes(id));
    this.participantPopover.show({
      visible: true,
      x,
      y,
      display: participant.display,
      kind: participant.kind ?? 'participant',
      boxLabel: box === -1 ? null : graph.boxes[box].label,
      onDisplayChange: (display) => this.commit({ kind: 'setParticipantDisplay', id, display }),
      onKindChange: (participantKind) => this.commit({ kind: 'setParticipantKind', id, participantKind }),
      ...(box !== -1 ? { onEditBox: () => this.select({ kind: 'box', index: box }) } : {}),
      onDelete: () => {
        // Cascades: every event involving this participant goes too.
        this.dropSelection();
        this.commit({ kind: 'deleteParticipant', id });
      },
      onClose: () => this.participantPopover.hide(),
    });
  }

  // Is the sender of message `index` working (has an activity bar) when
  // the message is sent? Only then can the message end it.
  private senderActive(index: number): boolean {
    const graph = this.graph;
    const map = this.map;
    const ev = graph?.events[index];
    if (!graph || !map || ev?.kind !== 'message') return false;
    const line = map.events[index].line;
    const steps: Array<{ line: number; who: string; on: boolean }> = [];
    graph.events.forEach((e, i) => {
      if (e.kind !== 'message' || !e.activation || i === index) return;
      steps.push({ line: map.events[i].line, who: e.activation === 'activate' ? e.to : e.from, on: e.activation === 'activate' });
    });
    for (const r of map.references) {
      if (r.kind === 'activate' || r.kind === 'deactivate') steps.push({ line: r.line, who: r.id, on: r.kind === 'activate' });
    }
    let n = 0;
    for (const s of steps.sort((a, b) => a.line - b.line)) {
      if (s.line >= line) break;
      if (s.who === ev.from) n = Math.max(0, n + (s.on ? 1 : -1));
    }
    return n > 0;
  }

  // The innermost block event `index` sits in.
  private blockOf(index: number): number | null {
    let best: number | null = null;
    this.graph?.blocks.forEach((b, i) => {
      if (b.start <= index && index < b.end && (best === null || b.start >= this.graph!.blocks[best].start)) best = i;
    });
    return best;
  }

  private blockTitle(index: number): string {
    const b = this.graph!.blocks[index];
    return b.kind === 'rect' ? BLOCK_NAMES.rect : b.label ? `${BLOCK_NAMES[b.kind]}: ${b.label}` : BLOCK_NAMES[b.kind];
  }

  private openMessagePopover(index: number): void {
    const ev = this.graph?.events[index];
    if (!ev || ev.kind !== 'message') return;
    const sel = this.selected?.kind === 'message' ? this.selected : { index };
    const [lo, hi] = this.run(sel);
    const { x, y } = this.host.anchor(this.eventElement(index), 'center');
    const block = this.blockOf(index);
    this.messagePopover.show({
      visible: true,
      x,
      y,
      text: ev.text,
      style: ev.style,
      activation: ev.activation ?? null,
      canDeactivate: this.senderActive(index),
      blockLabel: block === null ? null : this.blockTitle(block),
      onTextChange: (text) => this.commit({ kind: 'setMessageText', index, text }),
      onStyleChange: (style) => this.commit({ kind: 'setMessageStyle', index, style }),
      onActivationChange: (activation) => this.commit({ kind: 'setMessageActivation', index, activation }),
      // The selected run [lo, hi] (all of it, notes in between included).
      onWrap: (blockKind) =>
        this.commit(
          { kind: 'addBlock', blockKind, label: blockKind === 'rect' ? HIGHLIGHTS[0] : '', start: lo, end: hi + 1 },
          (r) => {
            if (r.index !== undefined) this.pendingSelect = { kind: 'block', index: r.index };
          },
        ),
      ...(block !== null ? { onEditBlock: () => this.select({ kind: 'block', index: block }) } : {}),
      onDelete: () => {
        this.dropSelection();
        this.commit({ kind: 'deleteMessage', index });
      },
      // "+ after": same from/to/style right below, so only the text is
      // left to type.
      onAddAfter: () =>
        this.commit(
          { kind: 'addMessage', from: ev.from, to: ev.to, text: '', style: ev.style === 'other' ? 'arrow' : ev.style, afterIndex: index },
          (r) => {
            if (r.index !== undefined) this.pendingSelect = { kind: 'message', index: r.index };
          },
        ),
      onClose: () => this.messagePopover.hide(),
    });
  }

  private openNotePopover(index: number): void {
    const ev = this.graph?.events[index];
    if (!this.graph || !ev || ev.kind !== 'note') return;
    const { x, y } = this.host.anchor(this.eventElement(index), 'right');
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

  private openBlockPopover(block: number): void {
    const b = this.graph?.blocks[block];
    if (!b) return;
    // A block whose first event is drawn anchors there when its own
    // frame isn't tagged (highlights).
    const el = this.blockElement(block) ?? (b.start < b.end ? this.eventElement(b.start) : null);
    const { x, y } = this.host.anchor(el, 'right');
    const fields: FormField[] = [];
    if (b.kind === 'rect') {
      fields.push({
        kind: 'swatches',
        id: 'colour',
        label: 'Colour',
        value: b.label,
        palette: HIGHLIGHTS,
        onChange: (c) => {
          if (c) this.commit({ kind: 'setBlockLabel', block, label: c });
        },
      });
    } else {
      const kinds: BlockKind[] = b.branches.length ? ['alt', 'par', 'critical'] : ['loop', 'opt', 'break', 'alt', 'par', 'critical'];
      const options: ChoiceOption[] = kinds.map((k) => ({ value: k, label: BLOCK_NAMES[k] }));
      fields.push(
        { kind: 'choice', id: 'kind', label: 'Kind', value: b.kind, options, display: 'select', onChange: (k) => this.commit({ kind: 'setBlockKind', block, blockKind: k as BlockKind }) },
        { kind: 'text', id: 'label', label: 'Label', value: b.label, placeholder: 'e.g. Every minute', className: 'mermaid-block-label', onCommit: (label) => this.commit({ kind: 'setBlockLabel', block, label }) },
      );
      const branchName = BRANCH_NAMES[b.kind];
      if (branchName) {
        fields.push({
          kind: 'rows',
          id: 'branches',
          label: branchName,
          columns: [{ id: 'label', label: 'Label', kind: 'text', placeholder: 'e.g. failure' }],
          rows: b.branches.map((label) => ({ label })),
          addLabel: `Add “${branchName.toLowerCase()}”`,
          onCell: (row, _col, value) => this.commit({ kind: 'setBranchLabel', block, branch: row, label: String(value) }),
          onAdd: () => this.commit({ kind: 'addBranch', block, label: '' }),
          onRemove: (row) => this.commit({ kind: 'removeBranch', block, branch: row }),
        });
      }
    }
    this.form.show({
      visible: true,
      x,
      y,
      key: `block:${block}`,
      title: BLOCK_NAMES[b.kind],
      fields,
      actions: [
        {
          id: 'remove-block',
          label: 'Remove block (keep the messages)',
          icon: 'ungroup',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'removeBlock', block });
          },
        },
      ],
      onClose: () => this.form.hide(),
    });
  }

  private openBoxPopover(box: number): void {
    const b = this.graph?.boxes[box];
    if (!b) return;
    const { x, y } = this.host.anchor(this.boxElement(box), 'right');
    this.form.show({
      visible: true,
      x,
      y,
      key: `box:${box}`,
      title: 'Group box',
      fields: [
        { kind: 'text', id: 'label', label: 'Name', value: b.label, className: 'mermaid-box-label', onCommit: (label) => this.commit({ kind: 'setBoxLabel', box, label }) },
        { kind: 'swatches', id: 'colour', label: 'Colour', value: b.color, palette: FILL_PALETTE, onChange: (color) => this.commit({ kind: 'setBoxColor', box, color }) },
      ],
      actions: [
        {
          id: 'remove-box',
          label: 'Remove box (keep the participants)',
          icon: 'ungroup',
          danger: true,
          onClick: () => {
            this.dropSelection();
            this.commit({ kind: 'removeBox', box });
          },
        },
      ],
      onClose: () => this.form.hide(),
    });
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
          value: this.graph?.title ?? '',
          placeholder: 'Title shown above the diagram',
          className: 'mermaid-title-input',
          onCommit: (title) => this.commit({ kind: 'setTitle', title }),
        },
      ],
      actions: [],
      onClose: () => {
        if (this.selected?.kind === 'title') this.selected = null;
        this.form.hide();
      },
    });
  }

  private refreshActions(): void {
    const graph = this.graph;
    if (!graph || graph.participants.size === 0) {
      // The empty-state placeholder owns the empty case.
      this.actions.hide();
      return;
    }
    const count = graph.participants.size;
    this.actions.show({
      visible: true,
      ariaLabel: 'Sequence diagram actions',
      items: [
        { id: 'add-participant', label: 'Participant', icon: 'plus', onClick: () => this.addParticipant() },
        { id: 'add-message', label: 'Message', icon: 'chat', disabled: count < 2, onClick: () => this.enterAddMessageMode() },
        { id: 'add-note', label: 'Note', icon: 'note', onClick: () => this.addNote() },
        { id: 'numbered', label: 'Numbered', icon: 'list', active: graph.autonumber, onClick: () => this.commit({ kind: 'setAutonumber', on: !graph.autonumber }) },
        { id: 'title', label: graph.title ? 'Title' : 'Add title', icon: 'text', onClick: () => this.select({ kind: 'title' }) },
      ],
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
