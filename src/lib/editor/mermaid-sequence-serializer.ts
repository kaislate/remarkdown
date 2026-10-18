// Emit a SequenceGraph as mermaid sequenceDiagram source.
// Single source of truth for the round-trip property:
//   parse(serialize(parse(text))) === parse(text)
// for the supported subset.
import type {
  SequenceGraph,
  Participant,
  MessageEvent,
  NoteEvent,
  MessageStyle,
  NotePosition,
} from './mermaid-sequence-graph';
import { encodeSequenceText } from './mermaid-sequence-parser';

export const MESSAGE_DELIM: Record<MessageStyle, string> = {
  solid: '->',
  arrow: '->>',
  dotted: '-->',
  reply: '-->>',
};

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
  return `participant ${p.id}${emitParticipantTail(p.display)}`;
}

// mermaid 11 requires the colon even when there's no text: `A->>B`
// alone is a parse error ("Expecting 'TXT'"), `A->>B:` is a message
// with an empty label. (New messages from "+ Message" / "+ after"
// start empty, so this matters on every add.)
export function emitMessageTail(text: string): string {
  const encoded = encode(text);
  return encoded ? `: ${encoded}` : ':';
}

function emitMessage(m: MessageEvent): string {
  return `${m.from}${MESSAGE_DELIM[m.style]}${m.to}${emitMessageTail(m.text)}`;
}

export function emitNoteHead(position: NotePosition, participants: string[]): string {
  // 'Note left of' → 'left of'; the "Note " lead-in stays in the line.
  return `${NOTE_PREFIX[position].slice('Note '.length)} ${participants.join(',')}`;
}

function emitNote(n: NoteEvent): string {
  return `Note ${emitNoteHead(n.position, n.participants)}: ${encode(n.text)}`;
}

export function serializeSequence(graph: SequenceGraph): string {
  const lines: string[] = ['sequenceDiagram'];
  for (const p of graph.participants.values()) {
    lines.push(emitParticipant(p));
  }
  for (const ev of graph.events) {
    if (ev.kind === 'message') lines.push(emitMessage(ev));
    else lines.push(emitNote(ev));
  }
  return lines.join('\n') + '\n';
}
