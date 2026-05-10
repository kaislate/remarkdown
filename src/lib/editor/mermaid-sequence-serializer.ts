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

// Strip anything that would terminate the current single-line mermaid
// statement and start a new one. Two failure modes are guarded:
//   1) a stray \n in text (e.g., paste, rune-state crossing) — without
//      this every event after the offender is glued onto the line
//      below in mermaid's eyes.
//   2) an arrow-shaped substring inside text that mermaid's parser
//      reads as a new message statement (e.g., text=`foo"B->>A`).
//      We've seen this in the wild without being able to reproduce the
//      upstream mutation; truncating at the first arrow keeps the
//      visible text and discards the glued tail so mermaid can render.
// The truncation is intentionally aggressive — losing the trailing
// part of a text that legitimately contains `->>` is a worse-than-
// usual edit experience but a far better failure mode than a broken
// document.
const ARROW_RE = /[\s\S]*?(?=\s*[A-Za-z][A-Za-z0-9_]*\s*(?:-->>|-->|->>|->)\s*[A-Za-z])/;
function flat(text: string): string {
  let out = text.replace(/\r?\n+/g, ' ');
  // If any arrow-shaped statement appears, drop everything from there
  // on. ARROW_RE captures the prefix (lazy) before the lookahead;
  // matching means there IS a glued statement; replace the whole input
  // with just the prefix.
  const m = ARROW_RE.exec(out);
  if (m && m[0].length < out.length) {
    out = m[0].trimEnd();
  }
  return out;
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
