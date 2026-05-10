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

const MESSAGE_DELIM: Record<MessageStyle, string> = {
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

function emitParticipant(p: Participant): string {
  if (!p.display) return `participant ${p.id}`;
  return `participant ${p.id} as ${flat(p.display)}`;
}

// Strip newlines from text fields before they reach a single-line
// mermaid statement. Without this, any stray \n in a message or note
// text turns into a serialized line break that mermaid then reads as
// the next statement — and since the next statement is invariably
// gibberish from the parser's POV, it errors out (we saw reports of
// "Expecting 'TXT', got 'NEWLINE'" with glued-together event lines).
// Replace with a single space so user content stays readable.
function flat(text: string): string {
  return text.replace(/\r?\n+/g, ' ');
}

function emitMessage(m: MessageEvent): string {
  const arrow = MESSAGE_DELIM[m.style];
  const text = flat(m.text);
  if (text) return `${m.from}${arrow}${m.to}: ${text}`;
  return `${m.from}${arrow}${m.to}`;
}

function emitNote(n: NoteEvent): string {
  const prefix = NOTE_PREFIX[n.position];
  const targets = n.participants.join(',');
  return `${prefix} ${targets}: ${flat(n.text)}`;
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
