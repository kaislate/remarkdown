// Pure data structures + manipulation helpers for a mermaid sequence
// diagram. The parser (mermaid-sequence-parser.ts) builds one from a
// source; the helpers below state what each visual edit means, and the
// tests check the source-preserving edit engine
// (mermaid-sequence-edit.ts) against them.
//
// A sequence diagram is fundamentally LINEAR — messages and notes
// happen in a specific order. We keep a single `events` array with
// tagged-union entries (`{kind: 'message', ...} | {kind: 'note', ...}`)
// so insertion / reordering / deletion work by index. Blocks (loop,
// alt / else, opt, par / and, critical / option, break, rect) are event
// ranges; boxes group participants.

// Arrow kinds: solid / dotted line × no head, arrowhead, cross, open
// (async) head, and two-way. 'other' is one of mermaid's newer half-
// arrows, kept as written.
export type MessageStyle =
  | 'solid'
  | 'arrow'
  | 'dotted'
  | 'reply'
  | 'cross'
  | 'dottedCross'
  | 'async'
  | 'dottedAsync'
  | 'both'
  | 'dottedBoth'
  | 'other';
export type NotePosition = 'leftOf' | 'rightOf' | 'over';
export type BlockKind = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect';

export interface Participant {
  id: string;
  display: string; // Empty string means "no display alias".
  // Drawn as a stick figure (`actor`) rather than a box.
  kind?: 'actor';
}

export interface MessageEvent {
  kind: 'message';
  from: string;
  to: string;
  text: string;
  style: MessageStyle;
  // `A->>+B` starts B's activation bar; `B-->>-A` ends B's.
  activation?: 'activate' | 'deactivate';
}

export interface NoteEvent {
  kind: 'note';
  participants: string[]; // 1 element for left/right of; 1-2 for over.
  position: NotePosition;
  text: string;
}

export type SequenceEvent = MessageEvent | NoteEvent;

export interface SequenceBlock {
  kind: BlockKind;
  // The label after the keyword (a rect's is its colour).
  label: string;
  // Labels of the branches after the first (`else` / `and` / `option`).
  branches: string[];
  // Enclosing block (index into blocks), null at the top level.
  parent: number | null;
  // Events inside: [start, end), and where each later branch begins.
  start: number;
  end: number;
  branchStarts: number[];
}

export interface SequenceBox {
  label: string;
  color: string | null;
  participants: string[];
}

export interface SequenceGraph {
  participants: Map<string, Participant>;
  events: SequenceEvent[];
  blocks: SequenceBlock[];
  boxes: SequenceBox[];
  // Numbered messages (`autonumber`).
  autonumber: boolean;
  title: string;
}

export function emptySequenceGraph(): SequenceGraph {
  return { participants: new Map(), events: [], blocks: [], boxes: [], autonumber: false, title: '' };
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

// Blocks after an event is inserted at `at` (inside the innermost block
// whose range strictly contains the insertion point, or ending at it
// when `into` names that block).
function blocksAfterInsert(blocks: SequenceBlock[], at: number, into: number | null): SequenceBlock[] {
  return blocks.map((b, i) => {
    const contains = isAncestorOrSelf(blocks, i, into);
    const shift = (x: number, inclusive: boolean) => (x > at || (inclusive && x === at) ? x + 1 : x);
    return {
      ...b,
      start: b.start > at || (b.start === at && !contains) ? b.start + 1 : b.start,
      end: shift(b.end, contains),
      // An insertion inside the block at a later branch's first position
      // lands at the end of the branch before (its line goes above the
      // `else`), so that branch now starts one later.
      branchStarts: b.branchStarts.map((s) => shift(s, contains)),
    };
  });
}

function isAncestorOrSelf(blocks: SequenceBlock[], i: number, of: number | null): boolean {
  for (let k = of; k !== null; k = blocks[k].parent) if (k === i) return true;
  return false;
}

function blocksAfterRemove(blocks: SequenceBlock[], at: number): SequenceBlock[] {
  const dec = (x: number) => (x > at ? x - 1 : x);
  return blocks.map((b) => ({ ...b, start: dec(b.start), end: dec(b.end), branchStarts: b.branchStarts.map(dec) }));
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

export function setParticipantKind(graph: SequenceGraph, id: string, kind: 'participant' | 'actor'): SequenceGraph {
  const p = graph.participants.get(id);
  if (!p) return graph;
  const participants = new Map(graph.participants);
  const { kind: _k, ...rest } = p;
  participants.set(id, kind === 'actor' ? { ...rest, kind } : rest);
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
  let out: SequenceGraph = { ...graph, participants };
  for (let i = out.events.length - 1; i >= 0; i--) {
    const ev = out.events[i];
    const hit = ev.kind === 'message' ? ev.from === id || ev.to === id : ev.participants.includes(id);
    if (hit) out = removeEvent(out, i);
  }
  const boxes = out.boxes
    .map((b) => ({ ...b, participants: b.participants.filter((p) => p !== id) }))
    .filter((b) => b.participants.length > 0);
  return { ...out, boxes };
}

function removeEvent(graph: SequenceGraph, index: number): SequenceGraph {
  return {
    ...graph,
    events: graph.events.filter((_, i) => i !== index),
    blocks: blocksAfterRemove(graph.blocks, index),
  };
}

// Insert an event at `at`, inside block `into` (null: whatever block
// strictly contains that position).
export function insertEvent(graph: SequenceGraph, at: number, event: SequenceEvent, into: number | null = null): SequenceGraph {
  const events = [...graph.events];
  events.splice(at, 0, event);
  return { ...graph, events, blocks: blocksAfterInsert(graph.blocks, at, into) };
}

export function addMessage(
  graph: SequenceGraph,
  spec: Omit<MessageEvent, 'kind'>,
): SequenceGraph {
  return insertEvent(graph, graph.events.length, { kind: 'message', ...spec });
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

export function setMessageActivation(
  graph: SequenceGraph,
  index: number,
  activation: 'activate' | 'deactivate' | null,
): SequenceGraph {
  const ev = graph.events[index];
  if (!ev || ev.kind !== 'message') return graph;
  const events = [...graph.events];
  const { activation: _a, ...rest } = ev;
  events[index] = activation ? { ...rest, activation } : rest;
  return { ...graph, events };
}

export function deleteMessage(
  graph: SequenceGraph,
  index: number,
): SequenceGraph {
  const ev = graph.events[index];
  if (!ev || ev.kind !== 'message') return graph;
  return removeEvent(graph, index);
}

export function addNote(
  graph: SequenceGraph,
  spec: Omit<NoteEvent, 'kind'>,
): SequenceGraph {
  return insertEvent(graph, graph.events.length, { kind: 'note', ...spec });
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
  return removeEvent(graph, index);
}

// ── blocks ───────────────────────────────────────────────────────────

// Wrap events [start, end) in a new block. Blocks are listed in source
// order (by where they open), so it slots in before the first block
// opening inside or after it.
export function addBlock(graph: SequenceGraph, kind: BlockKind, label: string, start: number, end: number): { graph: SequenceGraph; index: number } {
  const parent = innermostContaining(graph.blocks, start, end);
  let index = graph.blocks.findIndex((b) => b.start >= start && !isAncestorOrSelf(graph.blocks, graph.blocks.indexOf(b), parent));
  if (index === -1) index = graph.blocks.length;
  const remapIdx = (i: number | null) => (i === null ? null : i >= index ? i + 1 : i);
  const blocks = graph.blocks.map((b) => ({ ...b, parent: remapIdx(b.parent) }));
  // Blocks the new one encloses now have it as their parent.
  blocks.forEach((b) => {
    if (b.parent === remapIdx(parent) && b.start >= start && b.end <= end) b.parent = index;
  });
  blocks.splice(index, 0, { kind, label, branches: [], parent: parent === null ? null : remapIdx(parent), start, end, branchStarts: [] });
  return { graph: { ...graph, blocks }, index };
}

function innermostContaining(blocks: SequenceBlock[], start: number, end: number): number | null {
  let best: number | null = null;
  blocks.forEach((b, i) => {
    if (b.start <= start && b.end >= end) {
      // A branch must contain the whole range too.
      if (best === null || (b.start >= blocks[best].start && b.end <= blocks[best].end)) best = i;
    }
  });
  return best;
}

export function setBlockLabel(graph: SequenceGraph, block: number, label: string): SequenceGraph {
  const b = graph.blocks[block];
  if (!b) return graph;
  const blocks = [...graph.blocks];
  blocks[block] = { ...b, label };
  return { ...graph, blocks };
}

export function setBranchLabel(graph: SequenceGraph, block: number, branch: number, label: string): SequenceGraph {
  const b = graph.blocks[block];
  if (!b || branch < 0 || branch >= b.branches.length) return graph;
  const blocks = [...graph.blocks];
  blocks[block] = { ...b, branches: b.branches.map((x, i) => (i === branch ? label : x)) };
  return { ...graph, blocks };
}

export function setBlockKind(graph: SequenceGraph, block: number, kind: BlockKind): SequenceGraph {
  const b = graph.blocks[block];
  if (!b) return graph;
  const blocks = [...graph.blocks];
  blocks[block] = { ...b, kind };
  return { ...graph, blocks };
}

// A new branch at the end of the block (empty).
export function addBranch(graph: SequenceGraph, block: number, label: string): SequenceGraph {
  const b = graph.blocks[block];
  if (!b) return graph;
  const blocks = [...graph.blocks];
  blocks[block] = { ...b, branches: [...b.branches, label], branchStarts: [...b.branchStarts, b.end] };
  return { ...graph, blocks };
}

// Remove a branch keeping its events (they join the branch before).
export function removeBranch(graph: SequenceGraph, block: number, branch: number): SequenceGraph {
  const b = graph.blocks[block];
  if (!b || branch < 0 || branch >= b.branches.length) return graph;
  const blocks = [...graph.blocks];
  blocks[block] = { ...b, branches: b.branches.filter((_, i) => i !== branch), branchStarts: b.branchStarts.filter((_, i) => i !== branch) };
  return { ...graph, blocks };
}

// Remove a block keeping its events (and inner blocks, which move up).
export function removeBlock(graph: SequenceGraph, block: number): SequenceGraph {
  const b = graph.blocks[block];
  if (!b) return graph;
  const remap = (i: number | null): number | null => (i === null ? null : i === block ? b.parent === null ? null : remap(b.parent) : i > block ? i - 1 : i);
  const blocks = graph.blocks.filter((_, i) => i !== block).map((x) => ({ ...x, parent: remap(x.parent) }));
  return { ...graph, blocks };
}

export function setAutonumber(graph: SequenceGraph, on: boolean): SequenceGraph {
  return { ...graph, autonumber: on };
}

export function setTitle(graph: SequenceGraph, title: string): SequenceGraph {
  return { ...graph, title };
}

// ── boxes ────────────────────────────────────────────────────────────

export function setBoxLabel(graph: SequenceGraph, box: number, label: string): SequenceGraph {
  const b = graph.boxes[box];
  if (!b) return graph;
  const boxes = [...graph.boxes];
  boxes[box] = { ...b, label };
  return { ...graph, boxes };
}

export function setBoxColor(graph: SequenceGraph, box: number, color: string | null): SequenceGraph {
  const b = graph.boxes[box];
  if (!b) return graph;
  const boxes = [...graph.boxes];
  boxes[box] = { ...b, color };
  return { ...graph, boxes };
}

export function removeBox(graph: SequenceGraph, box: number): SequenceGraph {
  if (!graph.boxes[box]) return graph;
  return { ...graph, boxes: graph.boxes.filter((_, i) => i !== box) };
}
