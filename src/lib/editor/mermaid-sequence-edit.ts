// Source-preserving visual edits for sequence diagrams — the sequence
// counterpart of mermaid-flowchart-edit.ts (see there for the why).
//
// Every statement in a sequence diagram is one line, so edits are
// line-local:
//   - text / style / activation / note-position / participant-name /
//     block-label edits splice the relevant part of one line (a style
//     change touches only the arrow, a text change only the text after
//     the colon)
//   - deletes remove whole statement lines (a participant takes its
//     declarations, its activate / destroy / link lines and every event
//     that involves it with it)
//   - additions insert one line: "+ after" right below its sibling,
//     new messages / notes after the last statement, a new participant
//     after the line where the current last participant first appears
//   - wrapping messages in a block adds its opening line above them and
//     its `end` below; removing a block removes those lines and keeps
//     what was inside
// Lines an edit doesn't touch — comments, blank lines, other messages
// with whatever text they had, indentation — are never re-emitted.
//
// Removing a message (or its activation mark) can leave a later
// deactivation with nothing to end, which mermaid rejects; such
// deactivations go with it (they are about the removed activation).
import {
  parseSequenceSource,
  encodeSequenceText,
  BRANCH_KEYWORD,
  leadingColor,
  type SequenceSourceMap,
} from './mermaid-sequence-parser';
import {
  MESSAGE_DELIM,
  activationMark,
  emitBlockStart,
  emitBranch,
  emitMessageTail,
  emitNoteHead,
  emitParticipantTail,
} from './mermaid-sequence-serializer';
import {
  addParticipant,
  type BlockKind,
  type MessageStyle,
  type NotePosition,
  type SequenceGraph,
} from './mermaid-sequence-graph';

export type SequenceEdit =
  | { kind: 'setParticipantDisplay'; id: string; display: string }
  | { kind: 'setParticipantKind'; id: string; participantKind: 'participant' | 'actor' }
  | { kind: 'deleteParticipant'; id: string }
  | { kind: 'addParticipant'; display: string; participantKind?: 'participant' | 'actor' }
  // Appended at the end, or inserted right after event `afterIndex`.
  | { kind: 'addMessage'; from: string; to: string; text: string; style: Exclude<MessageStyle, 'other'>; afterIndex?: number }
  | { kind: 'setMessageText'; index: number; text: string }
  | { kind: 'setMessageStyle'; index: number; style: Exclude<MessageStyle, 'other'> }
  // Start the receiver's activation bar / end the sender's / neither.
  | { kind: 'setMessageActivation'; index: number; activation: 'activate' | 'deactivate' | null }
  | { kind: 'deleteMessage'; index: number }
  | { kind: 'addNote'; participants: string[]; position: NotePosition; text: string; afterIndex?: number }
  | { kind: 'setNoteText'; index: number; text: string }
  | { kind: 'setNotePosition'; index: number; participants: string[]; position: NotePosition }
  | { kind: 'deleteNote'; index: number }
  // Wrap events [start, end) — all at one level of one block branch.
  | { kind: 'addBlock'; blockKind: BlockKind; label: string; start: number; end: number }
  | { kind: 'setBlockLabel'; block: number; label: string }
  | { kind: 'setBlockKind'; block: number; blockKind: BlockKind }
  | { kind: 'setBranchLabel'; block: number; branch: number; label: string }
  | { kind: 'addBranch'; block: number; label: string }
  | { kind: 'removeBranch'; block: number; branch: number }
  | { kind: 'removeBlock'; block: number }
  | { kind: 'setAutonumber'; on: boolean }
  | { kind: 'setBoxLabel'; box: number; label: string }
  | { kind: 'setBoxColor'; box: number; color: string | null }
  | { kind: 'removeBox'; box: number }
  | { kind: 'setTitle'; title: string };

export interface SequenceEditResult {
  source: string;
  // Id of the participant an addParticipant edit created.
  id?: string;
  // Event index of the message / note an add edit created, or the
  // block index an addBlock created.
  index?: number;
}

const DEFAULT_INDENT = '    ';

// Block kinds that hold one run of events; the others can have
// branches (else / and / option).
const SINGLE: ReadonlySet<BlockKind> = new Set(['loop', 'opt', 'break', 'rect']);

function indentOf(line: string): string {
  return /^\s*/.exec(line)![0];
}

function replaceRange(line: string, start: number, end: number, text: string): string {
  return line.slice(0, start) + text + line.slice(end);
}

function lastStatementLine(map: SequenceSourceMap): number {
  return map.statementLines.length
    ? map.statementLines[map.statementLines.length - 1]
    : map.directiveLine;
}

// Indentation for a line inserted after `line`: copy it from that line
// when it's a statement, else from the first statement, else default.
function indentNear(map: SequenceSourceMap, line: number): string {
  if (map.statementLines.includes(line)) return indentOf(map.lines[line]);
  const first = map.statementLines[0];
  return first !== undefined ? indentOf(map.lines[first]) : DEFAULT_INDENT;
}

function eventMentions(graph: SequenceGraph, index: number, id: string): boolean {
  const ev = graph.events[index];
  return ev.kind === 'message' ? ev.from === id || ev.to === id : ev.participants.includes(id);
}

// Line edits, applied at the end: replacements by line, insertions
// before / after a line, removals.
class LineEdits {
  private replaced = new Map<number, string>();
  private before = new Map<number, string[]>();
  private after = new Map<number, string[]>();
  private dropped = new Set<number>();
  constructor(private readonly map: SequenceSourceMap) {}

  line(n: number): string {
    return this.replaced.get(n) ?? this.map.lines[n];
  }
  set(n: number, text: string): void {
    this.replaced.set(n, text);
  }
  drop(n: number): void {
    this.dropped.add(n);
  }
  isDropped(n: number): boolean {
    return this.dropped.has(n);
  }
  insertBefore(n: number, texts: string[]): void {
    this.before.set(n, [...(this.before.get(n) ?? []), ...texts]);
  }
  insertAfter(n: number, texts: string[]): void {
    this.after.set(n, [...(this.after.get(n) ?? []), ...texts]);
  }
  apply(): string {
    const out: string[] = [];
    this.map.lines.forEach((_, n) => {
      out.push(...(this.before.get(n) ?? []));
      if (!this.dropped.has(n)) out.push(this.line(n));
      out.push(...(this.after.get(n) ?? []));
    });
    return out.join(this.map.eol);
  }
}

// Deactivations that end nothing once the source has changed — mermaid
// throws on them ("Trying to inactivate an inactive participant"). The
// first such mark / line goes, and the check runs again until the
// source is consistent.
function repairActivations(source: string): string {
  for (let round = 0; round < 50; round++) {
    const parsed = parseSequenceSource(source);
    if (!parsed.ok) return source;
    const { graph, map } = parsed;
    // Activation steps in line order, each with the fix that drops it.
    const steps: Array<{ line: number; who: string; on: boolean; drop: () => string }> = [];
    graph.events.forEach((ev, i) => {
      const src = map.events[i];
      if (ev.kind !== 'message' || !ev.activation || src.kind !== 'message' || !src.activation) return;
      const span = src.activation;
      steps.push({
        line: src.line,
        who: ev.activation === 'activate' ? ev.to : ev.from,
        on: ev.activation === 'activate',
        drop: () => {
          const lines = [...map.lines];
          lines[src.line] = replaceRange(lines[src.line], span.start, span.end, '');
          return lines.join(map.eol);
        },
      });
    });
    for (const r of map.references) {
      if (r.kind !== 'activate' && r.kind !== 'deactivate') continue;
      steps.push({ line: r.line, who: r.id, on: r.kind === 'activate', drop: () => map.lines.filter((_, n) => n !== r.line).join(map.eol) });
    }
    steps.sort((a, b) => a.line - b.line);
    const active = new Map<string, number>();
    const bad = steps.find((s) => {
      const n = active.get(s.who) ?? 0;
      if (s.on) active.set(s.who, n + 1);
      else if (n > 0) active.set(s.who, n - 1);
      else return true;
      return false;
    });
    if (!bad) return source;
    source = bad.drop();
  }
  return source;
}

// Is [start, end) a run of events one block branch can hold — no block
// starting or ending part-way through it?
function wrappable(graph: SequenceGraph, map: SequenceSourceMap, start: number, end: number): boolean {
  if (start < 0 || end > graph.events.length || start >= end) return false;
  const first = map.events[start].line;
  const last = map.events[end - 1].line;
  for (let b = 0; b < map.blocks.length; b++) {
    const s = map.blocks[b];
    const lines = [s.start, ...s.branches.map((x) => x.line), s.end];
    const inside = lines.filter((l) => l > first && l < last).length;
    if (inside !== 0 && inside !== lines.length) return false;
    // The range sits in one branch of an enclosing block.
    if (s.start < first && s.end > last && lines.some((l) => l > first && l < last)) return false;
  }
  return true;
}

// Apply one visual edit to sequenceDiagram `source`. Returns null when
// the source is outside what the editor reads or the edit names
// something that doesn't exist.
export function applySequenceEdit(source: string, edit: SequenceEdit): SequenceEditResult | null {
  const parsed = parseSequenceSource(source);
  if (!parsed.ok) return null;
  const { graph, map } = parsed;
  const L = new LineEdits(map);
  const extra: Pick<SequenceEditResult, 'id' | 'index'> = {};
  let repair = false;

  switch (edit.kind) {
    case 'setParticipantDisplay':
    case 'setParticipantKind': {
      const p = graph.participants.get(edit.id);
      if (!p) return null;
      const decls = map.declarations.get(edit.id) ?? [];
      if (edit.kind === 'setParticipantKind') {
        const kw = edit.participantKind;
        if ((p.kind ?? 'participant') === kw) return { source };
        if (decls.length) {
          // Every declaration says what it is; they all change.
          for (const d of decls) L.set(d.line, replaceRange(L.line(d.line), d.keyword.start, d.keyword.end, kw));
          break;
        }
      } else if (decls.length) {
        // mermaid shows the last aliased declaration; rename that one
        // (or the last bare one when none has an alias).
        const target = [...decls].reverse().find((d) => d.hasDisplay) ?? decls[decls.length - 1];
        // Replace only " as Display" — a trailing `# comment` stays.
        L.set(target.line, replaceRange(L.line(target.line), target.idEnd, target.tailEnd, emitParticipantTail(edit.display)));
        break;
      } else if (!edit.display) {
        return { source };
      }
      // Implicit participant: declare it right before the line where it
      // first appears. Participants first mentioned on that same line
      // ahead of it get a bare declaration too, so the order mermaid
      // lays them out in stays the same.
      const line = map.firstMention.get(edit.id)!;
      const indent = indentOf(map.lines[line]);
      const decl: string[] = [];
      for (const id of graph.participants.keys()) {
        if (id === edit.id) break;
        if (map.firstMention.get(id) === line && !map.declarations.has(id)) decl.push(`${indent}participant ${id}`);
      }
      const keyword = edit.kind === 'setParticipantKind' ? edit.participantKind : 'participant';
      const tail = edit.kind === 'setParticipantDisplay' ? emitParticipantTail(edit.display) : emitParticipantTail(p.display);
      decl.push(`${indent}${keyword} ${edit.id}${tail}`);
      L.insertBefore(line, decl);
      break;
    }
    case 'deleteParticipant': {
      if (!graph.participants.has(edit.id)) return null;
      for (const d of map.declarations.get(edit.id) ?? []) L.drop(d.line);
      for (const r of map.references) if (r.id === edit.id) L.drop(r.line);
      graph.events.forEach((_, i) => {
        if (eventMentions(graph, i, edit.id)) L.drop(map.events[i].line);
      });
      // A box left with nobody in it goes too.
      graph.boxes.forEach((b, i) => {
        if (b.participants.length && b.participants.every((p) => p === edit.id)) {
          L.drop(map.boxes[i].start);
          L.drop(map.boxes[i].end);
        }
      });
      repair = true;
      break;
    }
    case 'addParticipant': {
      const { id } = addParticipant(graph, { display: edit.display });
      // Next to the last participant: after the line where it first
      // appears (its declaration, or the message that introduced it) —
      // but never inside a box.
      const order = Array.from(graph.participants.keys());
      const lastId = order[order.length - 1];
      let after = lastId !== undefined ? map.firstMention.get(lastId)! : map.directiveLine;
      const box = map.boxes.find((b) => b.start < after && b.end >= after);
      if (box) after = box.end;
      const kw = edit.participantKind ?? 'participant';
      L.insertAfter(after, [`${indentNear(map, after)}${kw} ${id}${emitParticipantTail(edit.display)}`]);
      extra.id = id;
      break;
    }
    case 'addMessage': {
      if (!graph.participants.has(edit.from) || !graph.participants.has(edit.to)) return null;
      const text = `${edit.from}${MESSAGE_DELIM[edit.style]}${edit.to}${emitMessageTail(edit.text)}`;
      if (edit.afterIndex !== undefined) {
        const sibling = map.events[edit.afterIndex];
        if (!sibling) return null;
        // After the sibling and anything that belongs to it on the
        // following lines (its activation statements): right below.
        L.insertAfter(sibling.line, [indentOf(map.lines[sibling.line]) + text]);
        extra.index = edit.afterIndex + 1;
      } else {
        const after = lastStatementLine(map);
        L.insertAfter(after, [indentNear(map, after) + text]);
        extra.index = graph.events.length;
      }
      break;
    }
    case 'addNote': {
      if (!edit.participants.length || edit.participants.some((p) => !graph.participants.has(p))) return null;
      const text = `Note ${emitNoteHead(edit.position, edit.participants)}: ${encodeSequenceText(edit.text)}`;
      if (edit.afterIndex !== undefined) {
        const sibling = map.events[edit.afterIndex];
        if (!sibling) return null;
        L.insertAfter(sibling.line, [indentOf(map.lines[sibling.line]) + text]);
        extra.index = edit.afterIndex + 1;
      } else {
        const after = lastStatementLine(map);
        L.insertAfter(after, [indentNear(map, after) + text]);
        extra.index = graph.events.length;
      }
      break;
    }
    case 'setMessageText':
    case 'setMessageStyle':
    case 'setMessageActivation': {
      const ev = graph.events[edit.index];
      const src = map.events[edit.index];
      if (ev?.kind !== 'message' || src?.kind !== 'message') return null;
      const line = map.lines[src.line];
      if (edit.kind === 'setMessageStyle') {
        L.set(src.line, replaceRange(line, src.arrow.start, src.arrow.end, MESSAGE_DELIM[edit.style]));
      } else if (edit.kind === 'setMessageActivation') {
        const mark = activationMark(edit.activation ?? undefined);
        const at = src.activation ?? { start: src.arrow.end, end: src.arrow.end };
        L.set(src.line, replaceRange(line, at.start, at.end, mark));
        repair = true;
      } else if (src.text && edit.text) {
        L.set(src.line, replaceRange(line, src.text.start, src.text.end, encodeSequenceText(edit.text)));
      } else {
        // Adding text to a bare message, or clearing it: rewrite from
        // the end of the `to` id.
        const end = src.text ? src.text.end : src.toEnd;
        L.set(src.line, replaceRange(line, src.toEnd, end, emitMessageTail(edit.text)));
      }
      break;
    }
    case 'setNoteText':
    case 'setNotePosition': {
      const ev = graph.events[edit.index];
      const src = map.events[edit.index];
      if (ev?.kind !== 'note' || src?.kind !== 'note') return null;
      const line = map.lines[src.line];
      if (edit.kind === 'setNoteText') {
        L.set(src.line, replaceRange(line, src.text.start, src.text.end, encodeSequenceText(edit.text)));
      } else {
        if (!edit.participants.length || edit.participants.some((p) => !graph.participants.has(p))) return null;
        L.set(src.line, replaceRange(line, src.head.start, src.head.end, emitNoteHead(edit.position, edit.participants)));
      }
      break;
    }
    case 'deleteMessage':
    case 'deleteNote': {
      const ev = graph.events[edit.index];
      const want = edit.kind === 'deleteMessage' ? 'message' : 'note';
      if (ev?.kind !== want) return null;
      L.drop(map.events[edit.index].line);
      repair = true;
      break;
    }
    case 'addBlock': {
      if (!wrappable(graph, map, edit.start, edit.end)) return null;
      if (edit.blockKind === 'rect' && !edit.label) return null;
      const first = map.events[edit.start].line;
      const last = map.events[edit.end - 1].line;
      const indent = indentOf(map.lines[first]);
      L.insertBefore(first, [indent + emitBlockStart(edit.blockKind, edit.label)]);
      L.insertAfter(last, [`${indent}end`]);
      // Blocks are numbered by where they open.
      extra.index = map.blocks.filter((b) => b.start < first).length;
      break;
    }
    case 'setBlockLabel': {
      const b = graph.blocks[edit.block];
      const s = map.blocks[edit.block];
      if (!b || !s) return null;
      if (b.kind === 'rect' && !edit.label) return null;
      const line = L.line(s.start);
      const text = b.kind === 'rect' ? edit.label : encodeSequenceText(edit.label);
      // `loop` with no label yet: the label goes after the keyword.
      const at = s.label.end > s.label.start ? s.label : { start: s.keyword.end, end: s.keyword.end };
      L.set(s.start, replaceRange(line, at.start, at.end, at === s.label ? text : text ? ` ${text}` : ''));
      break;
    }
    case 'setBranchLabel': {
      const s = map.blocks[edit.block];
      const br = s?.branches[edit.branch];
      if (!br) return null;
      const line = L.line(br.line);
      const text = encodeSequenceText(edit.label);
      const at = br.label.end > br.label.start ? br.label : { start: br.keyword.end, end: br.keyword.end };
      L.set(br.line, replaceRange(line, at.start, at.end, at === br.label ? text : text ? ` ${text}` : ''));
      break;
    }
    case 'setBlockKind': {
      const b = graph.blocks[edit.block];
      const s = map.blocks[edit.block];
      if (!b || !s) return null;
      if (b.kind === edit.blockKind) return { source };
      // A block with branches stays a branching kind; a rect's label is
      // a colour, no other kind's is.
      if (b.branches.length && SINGLE.has(edit.blockKind)) return null;
      if ((b.kind === 'rect') !== (edit.blockKind === 'rect')) return null;
      L.set(s.start, replaceRange(L.line(s.start), s.keyword.start, s.keyword.end, edit.blockKind));
      const kw = BRANCH_KEYWORD[edit.blockKind];
      for (const br of s.branches) {
        if (!kw) return null;
        L.set(br.line, replaceRange(L.line(br.line), br.keyword.start, br.keyword.end, kw));
      }
      break;
    }
    case 'addBranch': {
      const b = graph.blocks[edit.block];
      const s = map.blocks[edit.block];
      if (!b || !s || SINGLE.has(b.kind)) return null;
      L.insertBefore(s.end, [indentOf(map.lines[s.start]) + emitBranch(b.kind, edit.label)]);
      break;
    }
    case 'removeBranch': {
      const br = map.blocks[edit.block]?.branches[edit.branch];
      if (!br) return null;
      L.drop(br.line);
      break;
    }
    case 'removeBlock': {
      const s = map.blocks[edit.block];
      if (!s) return null;
      L.drop(s.start);
      for (const br of s.branches) L.drop(br.line);
      L.drop(s.end);
      break;
    }
    case 'setAutonumber': {
      if (graph.autonumber === edit.on) return { source };
      if (edit.on) {
        // First thing after the header (after a title, if any).
        const after = map.title && map.title.line < (map.statementLines[0] ?? Infinity) + 1 ? map.title.line : map.directiveLine;
        L.insertAfter(after, [`${indentNear(map, map.statementLines[0] ?? after)}autonumber`]);
      } else {
        for (const n of map.autonumber) L.drop(n);
      }
      break;
    }
    case 'setBoxLabel':
    case 'setBoxColor': {
      const b = graph.boxes[edit.box];
      const s = map.boxes[edit.box];
      if (!b || !s) return null;
      const label = edit.kind === 'setBoxLabel' ? edit.label : b.label;
      const color = edit.kind === 'setBoxColor' ? edit.color : b.color;
      // A label that itself starts with a colour name would read as the
      // colour: keep the colour slot filled so it can't.
      const needsColor = !!label && !color && leadingColor(label) > 0;
      const head = [needsColor ? 'transparent' : color, label ? encodeSequenceText(label) : ''].filter(Boolean).join(' ');
      const line = L.line(s.start);
      L.set(s.start, line.slice(0, s.keywordEnd) + (head ? ` ${head}` : '') + line.slice(trailingStart(line, s)));
      break;
    }
    case 'removeBox': {
      const s = map.boxes[edit.box];
      if (!s) return null;
      L.drop(s.start);
      L.drop(s.end);
      break;
    }
    case 'setTitle': {
      if (graph.title === edit.title) return { source };
      if (map.title) {
        if (!edit.title) L.drop(map.title.line);
        else L.set(map.title.line, replaceRange(map.lines[map.title.line], map.title.text.start, map.title.text.end, encodeSequenceText(edit.title)));
      } else if (edit.title) {
        L.insertAfter(map.directiveLine, [`${indentNear(map, map.statementLines[0] ?? map.directiveLine)}title ${encodeSequenceText(edit.title)}`]);
      }
      break;
    }
  }

  keepFirstMentions(L, map, graph, edit.kind === 'deleteParticipant' ? edit.id : null);
  let out = L.apply();
  if (repair) out = repairLifecycle(repairActivations(out));
  return { source: out, ...extra };
}

// mermaid wants the message right after `create participant X` to be
// sent to X, and the one right after `destroy X` to involve X. When that message is gone, the `create`
// keyword goes (X is simply declared there) and so does the `destroy`.
function repairLifecycle(source: string): string {
  const parsed = parseSequenceSource(source);
  if (!parsed.ok) return source;
  const { graph, map } = parsed;
  const lines = [...map.lines];
  const drop = new Set<number>();
  const nextMessage = (after: number) => {
    let best: { line: number; from: string; to: string } | null = null;
    graph.events.forEach((ev, i) => {
      const line = map.events[i].line;
      if (ev.kind === 'message' && line > after && (!best || line < best.line)) best = { line, from: ev.from, to: ev.to };
    });
    return best as { line: number; from: string; to: string } | null;
  };
  for (const [id, decls] of map.declarations) {
    for (const d of decls) {
      if (!d.created) continue;
      // The creating message is the next one, sent TO the new participant.
      const m = nextMessage(d.line);
      if (m && m.to === id) continue;
      lines[d.line] = lines[d.line].replace(/create\s+/, '');
    }
  }
  for (const r of map.references) {
    if (r.kind !== 'destroy') continue;
    const m = nextMessage(r.line);
    if (!m || (m.from !== r.id && m.to !== r.id)) drop.add(r.line);
  }
  return lines.filter((_, n) => !drop.has(n)).join(map.eol);
}

// A removed line may be where some other participant first appears:
// it would then move to the end of the line-up, or (if nothing else
// mentions it) vanish. A bare declaration in the removed line's place
// keeps it where it was.
function keepFirstMentions(L: LineEdits, map: SequenceSourceMap, graph: SequenceGraph, deleted: string | null): void {
  for (const id of graph.participants.keys()) {
    if (id === deleted) continue;
    const line = map.firstMention.get(id)!;
    if (!L.isDropped(line) || (map.declarations.get(id) ?? []).some((d) => d.line === line)) continue;
    L.insertBefore(line, [`${indentOf(map.lines[line])}participant ${id}`]);
  }
}

// Where a box header's own text ends (a trailing `# comment` stays).
function trailingStart(line: string, s: { keywordEnd: number }): number {
  const rest = line.slice(s.keywordEnd);
  const hash = rest.search(/#(?!\w+;)/);
  const visible = hash === -1 ? rest : rest.slice(0, hash);
  return s.keywordEnd + visible.trimEnd().length;
}
