// Pure data structures + manipulation helpers for a mermaid sequence
// diagram. Mirrors the shape of mermaid-graph.ts (the flowchart
// equivalent) so the NodeView can hold one or the other and the
// serializer / parser modules can be swapped in cleanly.
//
// A sequence diagram is fundamentally LINEAR — messages and notes
// happen in a specific order. We keep a single `events` array with
// tagged-union entries (`{kind: 'message', ...} | {kind: 'note', ...}`)
// so insertion / reordering / deletion work by index.

export type MessageStyle = 'solid' | 'arrow' | 'dotted' | 'reply';
export type NotePosition = 'leftOf' | 'rightOf' | 'over';

export interface Participant {
  id: string;
  display: string; // Empty string means "no display alias".
}

export interface MessageEvent {
  kind: 'message';
  from: string;
  to: string;
  text: string;
  style: MessageStyle;
}

export interface NoteEvent {
  kind: 'note';
  participants: string[]; // 1 element for left/right of; 1-2 for over.
  position: NotePosition;
  text: string;
}

export type SequenceEvent = MessageEvent | NoteEvent;

export interface SequenceGraph {
  participants: Map<string, Participant>;
  events: SequenceEvent[];
}

export function emptySequenceGraph(): SequenceGraph {
  return { participants: new Map(), events: [] };
}

// Same A, B, ..., Z, AA, AB, ... id-generation pattern as the
// flowchart graph.
function nextId(graph: SequenceGraph): string {
  for (let i = 0; ; i++) {
    const id = idFromIndex(i);
    if (!graph.participants.has(id)) return id;
  }
}

function idFromIndex(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function addParticipant(
  graph: SequenceGraph,
  spec: { display: string },
): { graph: SequenceGraph; id: string } {
  const id = nextId(graph);
  const participants = new Map(graph.participants);
  participants.set(id, { id, display: spec.display });
  return { graph: { ...graph, participants }, id };
}

export function setParticipantDisplay(
  graph: SequenceGraph,
  id: string,
  display: string,
): SequenceGraph {
  const p = graph.participants.get(id);
  if (!p) return graph;
  const participants = new Map(graph.participants);
  participants.set(id, { ...p, display });
  return { ...graph, participants };
}

export function deleteParticipant(
  graph: SequenceGraph,
  id: string,
): SequenceGraph {
  if (!graph.participants.has(id)) return graph;
  const participants = new Map(graph.participants);
  participants.delete(id);
  // Cascade: drop any event that references this participant.
  const events = graph.events.filter((ev) => {
    if (ev.kind === 'message') return ev.from !== id && ev.to !== id;
    return !ev.participants.includes(id);
  });
  return { ...graph, participants, events };
}

export function addMessage(
  graph: SequenceGraph,
  spec: Omit<MessageEvent, 'kind'>,
): SequenceGraph {
  return {
    ...graph,
    events: [...graph.events, { kind: 'message', ...spec }],
  };
}

export function setMessageText(
  graph: SequenceGraph,
  index: number,
  text: string,
): SequenceGraph {
  const ev = graph.events[index];
  if (!ev || ev.kind !== 'message') return graph;
  const events = [...graph.events];
  events[index] = { ...ev, text };
  return { ...graph, events };
}

export function setMessageStyle(
  graph: SequenceGraph,
  index: number,
  style: MessageStyle,
): SequenceGraph {
  const ev = graph.events[index];
  if (!ev || ev.kind !== 'message') return graph;
  const events = [...graph.events];
  events[index] = { ...ev, style };
  return { ...graph, events };
}

export function deleteMessage(
  graph: SequenceGraph,
  index: number,
): SequenceGraph {
  const ev = graph.events[index];
  if (!ev || ev.kind !== 'message') return graph;
  return { ...graph, events: graph.events.filter((_, i) => i !== index) };
}

export function addNote(
  graph: SequenceGraph,
  spec: Omit<NoteEvent, 'kind'>,
): SequenceGraph {
  return {
    ...graph,
    events: [...graph.events, { kind: 'note', ...spec }],
  };
}

export function setNoteText(
  graph: SequenceGraph,
  index: number,
  text: string,
): SequenceGraph {
  const ev = graph.events[index];
  if (!ev || ev.kind !== 'note') return graph;
  const events = [...graph.events];
  events[index] = { ...ev, text };
  return { ...graph, events };
}

export function setNotePosition(
  graph: SequenceGraph,
  index: number,
  spec: { participants: string[]; position: NotePosition },
): SequenceGraph {
  const ev = graph.events[index];
  if (!ev || ev.kind !== 'note') return graph;
  const events = [...graph.events];
  events[index] = { ...ev, ...spec };
  return { ...graph, events };
}

export function deleteNote(graph: SequenceGraph, index: number): SequenceGraph {
  const ev = graph.events[index];
  if (!ev || ev.kind !== 'note') return graph;
  return { ...graph, events: graph.events.filter((_, i) => i !== index) };
}
