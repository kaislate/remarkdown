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
  return `participant ${p.id} as ${p.display}`;
}

function emitMessage(m: MessageEvent): string {
  const arrow = MESSAGE_DELIM[m.style];
  if (m.text) return `${m.from}${arrow}${m.to}: ${m.text}`;
  return `${m.from}${arrow}${m.to}`;
}

function emitNote(n: NoteEvent): string {
  const prefix = NOTE_PREFIX[n.position];
  const targets = n.participants.join(',');
  return `${prefix} ${targets}: ${n.text}`;
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
