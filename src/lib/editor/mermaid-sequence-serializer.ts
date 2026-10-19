// Emit a SequenceGraph as mermaid sequenceDiagram source, and the
// statement pieces mermaid-sequence-edit.ts splices into existing
// sources. Round-trip property for whole graphs:
//   parse(serialize(parse(text))) === parse(text)
import type {
  SequenceGraph,
  Participant,
  MessageEvent,
  NoteEvent,
  MessageStyle,
  NotePosition,
  BlockKind,
} from './mermaid-sequence-graph';
import { encodeSequenceText, MESSAGE_STYLES, BRANCH_KEYWORD } from './mermaid-sequence-parser';

export const MESSAGE_DELIM: Record<Exclude<MessageStyle, 'other'>, string> = Object.fromEntries(
  MESSAGE_STYLES.map((s) => [s.style, s.delim]),
) as Record<Exclude<MessageStyle, 'other'>, string>;

const NOTE_PREFIX: Record<NotePosition, string> = {
  leftOf: 'Note left of',
  rightOf: 'Note right of',
  over: 'Note over',
};

// User text → single-line statement text. History: this used to be
// `flat()`, which (PRs #19/#20) stripped newlines AND truncated text at
// the first arrow-shaped substring, after a user hit a message whose
// text had another statement glued onto it ('"latest update
// available"B->>A'). Two findings retired the truncation:
//   - mermaid 11.14 renders such text verbatim (tested in
//     mermaid-sequence-edit.test.ts), so it wasn't what broke the
//     diagram — but truncating mangled legitimate text ("Map x->y and
//     back" became "Map") on EVERY save, even when editing a different
//     message, and emptied notes / names like "a->b".
//   - the visual editor no longer re-emits lines it didn't edit
//     (mermaid-sequence-edit.ts), so a glued line coming from
//     elsewhere is left as found rather than "repaired" by data loss.
// What does break mermaid is kept out by encodeSequenceText: newlines
// (one statement per line), and `;` / `#` (written as entity codes).
const encode = encodeSequenceText;

export function emitParticipantTail(display: string): string {
  return display ? ` as ${encode(display)}` : '';
}

function emitParticipant(p: Participant): string {
  return `${p.kind === 'actor' ? 'actor' : 'participant'} ${p.id}${emitParticipantTail(p.display)}`;
}

// mermaid 11 requires the colon even when there's no text: `A->>B`
// alone is a parse error ("Expecting 'TXT'"), `A->>B:` is a message
// with an empty label. (New messages from "+ Message" / "+ after"
// start empty, so this matters on every add.)
export function emitMessageTail(text: string): string {
  const encoded = encode(text);
  return encoded ? `: ${encoded}` : ':';
}

export function activationMark(activation: MessageEvent['activation']): string {
  return activation === 'activate' ? '+' : activation === 'deactivate' ? '-' : '';
}

function emitMessage(m: MessageEvent): string {
  const delim = m.style === 'other' ? MESSAGE_DELIM.arrow : MESSAGE_DELIM[m.style];
  return `${m.from}${delim}${activationMark(m.activation)}${m.to}${emitMessageTail(m.text)}`;
}

export function emitNoteHead(position: NotePosition, participants: string[]): string {
  // 'Note left of' → 'left of'; the "Note " lead-in stays in the line.
  return `${NOTE_PREFIX[position].slice('Note '.length)} ${participants.join(',')}`;
}

function emitNote(n: NoteEvent): string {
  return `Note ${emitNoteHead(n.position, n.participants)}: ${encode(n.text)}`;
}

// A block's opening line (`loop Every minute`, `rect rgb(…)`). A rect's
// label is its colour and is written as given.
export function emitBlockStart(kind: BlockKind, label: string): string {
  const text = kind === 'rect' ? label : encode(label);
  return text ? `${kind} ${text}` : kind;
}

export function emitBranch(kind: BlockKind, label: string): string {
  const kw = BRANCH_KEYWORD[kind] ?? 'else';
  const text = encode(label);
  return text ? `${kw} ${text}` : kw;
}

export function serializeSequence(graph: SequenceGraph): string {
  const lines: string[] = ['sequenceDiagram'];
  if (graph.title) lines.push(`title ${encode(graph.title)}`);
  if (graph.autonumber) lines.push('autonumber');
  for (const p of graph.participants.values()) {
    lines.push(emitParticipant(p));
  }
  for (const ev of graph.events) {
    if (ev.kind === 'message') lines.push(emitMessage(ev));
    else lines.push(emitNote(ev));
  }
  return lines.join('\n') + '\n';
}
