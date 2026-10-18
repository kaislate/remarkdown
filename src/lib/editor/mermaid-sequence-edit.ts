// Source-preserving visual edits for sequence diagrams — the sequence
// counterpart of mermaid-flowchart-edit.ts (see there for the why).
//
// Every statement in a sequence diagram is one line, so edits are
// line-local:
//   - text / style / note-position / participant-name edits splice the
//     relevant part of one line (a style change touches only the
//     arrow, a text change only the text after the colon)
//   - deletes remove whole statement lines (a participant takes its
//     declarations and every event that involves it with it)
//   - additions insert one line: "+ after" right below its sibling,
//     new messages / notes after the last statement, a new participant
//     after the line where the current last participant first appears
// Lines an edit doesn't touch — comments, blank lines, other messages
// with whatever text they had — are never re-emitted.
import {
  parseSequenceSource,
  encodeSequenceText,
  type SequenceSourceMap,
} from './mermaid-sequence-parser';
import {
  MESSAGE_DELIM,
  emitMessageTail,
  emitNoteHead,
  emitParticipantTail,
} from './mermaid-sequence-serializer';
import {
  addParticipant,
  type MessageStyle,
  type NotePosition,
  type SequenceGraph,
} from './mermaid-sequence-graph';

export type SequenceEdit =
  | { kind: 'setParticipantDisplay'; id: string; display: string }
  | { kind: 'deleteParticipant'; id: string }
  | { kind: 'addParticipant'; display: string }
  // Appended at the end, or inserted right after event `afterIndex`.
  | { kind: 'addMessage'; from: string; to: string; text: string; style: MessageStyle; afterIndex?: number }
  | { kind: 'setMessageText'; index: number; text: string }
  | { kind: 'setMessageStyle'; index: number; style: MessageStyle }
  | { kind: 'deleteMessage'; index: number }
  | { kind: 'addNote'; participants: string[]; position: NotePosition; text: string }
  | { kind: 'setNoteText'; index: number; text: string }
  | { kind: 'setNotePosition'; index: number; participants: string[]; position: NotePosition }
  | { kind: 'deleteNote'; index: number };

export interface SequenceEditResult {
  source: string;
  // Id of the participant an addParticipant edit created.
  id?: string;
  // Event index of the message / note an add edit created.
  index?: number;
}

const DEFAULT_INDENT = '    ';

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

// Insert `texts` (already indented) after source line `after`.
function insertAfter(lines: string[], after: number, texts: string[]): void {
  lines.splice(after + 1, 0, ...texts);
}

function eventMentions(graph: SequenceGraph, index: number, id: string): boolean {
  const ev = graph.events[index];
  return ev.kind === 'message' ? ev.from === id || ev.to === id : ev.participants.includes(id);
}

// Apply one visual edit to sequenceDiagram `source`. Returns null when
// the source is outside the editable subset or the edit names
// something that doesn't exist.
export function applySequenceEdit(source: string, edit: SequenceEdit): SequenceEditResult | null {
  const parsed = parseSequenceSource(source);
  if (!parsed.ok) return null;
  const { graph, map } = parsed;
  const lines = [...map.lines];
  const extra: Pick<SequenceEditResult, 'id' | 'index'> = {};

  switch (edit.kind) {
    case 'setParticipantDisplay': {
      if (!graph.participants.has(edit.id)) return null;
      const decls = map.declarations.get(edit.id) ?? [];
      // mermaid shows the last aliased declaration; rename that one (or
      // the last bare one when none has an alias).
      const target = [...decls].reverse().find((d) => d.hasDisplay) ?? decls[decls.length - 1];
      if (target) {
        // Replace only " as Display" — a trailing `# comment` stays.
        lines[target.line] = replaceRange(
          lines[target.line],
          target.idEnd,
          target.tailEnd,
          emitParticipantTail(edit.display),
        );
        break;
      }
      // Implicit participant: declare it right before the line where it
      // first appears. Participants first mentioned on that same line
      // ahead of it get a bare declaration too, so the order mermaid
      // lays them out in stays the same.
      if (!edit.display) return { source };
      const line = map.firstMention.get(edit.id)!;
      const indent = indentOf(lines[line]);
      const order = Array.from(graph.participants.keys());
      const decl: string[] = [];
      for (const id of order) {
        if (id === edit.id) break;
        if (map.firstMention.get(id) === line && !map.declarations.has(id)) decl.push(`${indent}participant ${id}`);
      }
      decl.push(`${indent}participant ${edit.id}${emitParticipantTail(edit.display)}`);
      insertAfter(lines, line - 1, decl);
      break;
    }
    case 'deleteParticipant': {
      if (!graph.participants.has(edit.id)) return null;
      const drop = new Set<number>((map.declarations.get(edit.id) ?? []).map((d) => d.line));
      graph.events.forEach((_, i) => {
        if (eventMentions(graph, i, edit.id)) drop.add(map.events[i].line);
      });
      return { source: lines.filter((_, i) => !drop.has(i)).join(map.eol) };
    }
    case 'addParticipant': {
      const { id } = addParticipant(graph, { display: edit.display });
      // Next to the last participant: after the line where it first
      // appears (its declaration, or the message that introduced it).
      const order = Array.from(graph.participants.keys());
      const lastId = order[order.length - 1];
      const after = lastId !== undefined ? map.firstMention.get(lastId)! : map.directiveLine;
      insertAfter(lines, after, [`${indentNear(map, after)}participant ${id}${emitParticipantTail(edit.display)}`]);
      extra.id = id;
      break;
    }
    case 'addMessage': {
      if (!graph.participants.has(edit.from) || !graph.participants.has(edit.to)) return null;
      const text = `${edit.from}${MESSAGE_DELIM[edit.style]}${edit.to}${emitMessageTail(edit.text)}`;
      if (edit.afterIndex !== undefined) {
        const sibling = map.events[edit.afterIndex];
        if (!sibling) return null;
        insertAfter(lines, sibling.line, [indentOf(lines[sibling.line]) + text]);
        extra.index = edit.afterIndex + 1;
      } else {
        const after = lastStatementLine(map);
        insertAfter(lines, after, [indentNear(map, after) + text]);
        extra.index = graph.events.length;
      }
      break;
    }
    case 'addNote': {
      if (!edit.participants.length || edit.participants.some((p) => !graph.participants.has(p))) return null;
      const after = lastStatementLine(map);
      const text = `Note ${emitNoteHead(edit.position, edit.participants)}: ${encodeSequenceText(edit.text)}`;
      insertAfter(lines, after, [indentNear(map, after) + text]);
      extra.index = graph.events.length;
      break;
    }
    case 'setMessageText':
    case 'setMessageStyle': {
      const ev = graph.events[edit.index];
      const src = map.events[edit.index];
      if (ev?.kind !== 'message' || src?.kind !== 'message') return null;
      const line = lines[src.line];
      if (edit.kind === 'setMessageStyle') {
        lines[src.line] = replaceRange(line, src.arrow.start, src.arrow.end, MESSAGE_DELIM[edit.style]);
      } else if (src.text && edit.text) {
        lines[src.line] = replaceRange(line, src.text.start, src.text.end, encodeSequenceText(edit.text));
      } else {
        // Adding text to a bare message, or clearing it: rewrite from
        // the end of the `to` id.
        const end = src.text ? src.text.end : src.toEnd;
        lines[src.line] = replaceRange(line, src.toEnd, end, emitMessageTail(edit.text));
      }
      break;
    }
    case 'setNoteText':
    case 'setNotePosition': {
      const ev = graph.events[edit.index];
      const src = map.events[edit.index];
      if (ev?.kind !== 'note' || src?.kind !== 'note') return null;
      const line = lines[src.line];
      if (edit.kind === 'setNoteText') {
        lines[src.line] = replaceRange(line, src.text.start, src.text.end, encodeSequenceText(edit.text));
      } else {
        if (!edit.participants.length || edit.participants.some((p) => !graph.participants.has(p))) return null;
        lines[src.line] = replaceRange(line, src.head.start, src.head.end, emitNoteHead(edit.position, edit.participants));
      }
      break;
    }
    case 'deleteMessage':
    case 'deleteNote': {
      const ev = graph.events[edit.index];
      const want = edit.kind === 'deleteMessage' ? 'message' : 'note';
      if (ev?.kind !== want) return null;
      const drop = map.events[edit.index].line;
      return { source: lines.filter((_, i) => i !== drop).join(map.eol) };
    }
  }

  return { source: lines.join(map.eol), ...extra };
}
