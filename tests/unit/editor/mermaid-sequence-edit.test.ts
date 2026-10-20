// Source-preserving visual edits on sequence diagrams, and the text
// encoding that lets users type anything into the popovers.
import { describe, it, expect, beforeAll } from 'vitest';
import mermaid from 'mermaid';
import { applySequenceEdit, type SequenceEdit } from '../../../src/lib/editor/mermaid-sequence-edit';
import { parseSequence, parseSequenceSource } from '../../../src/lib/editor/mermaid-sequence-parser';
import { serializeSequence } from '../../../src/lib/editor/mermaid-sequence-serializer';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import { corpusBlocks, removedLines } from './mermaid-test-utils';
import {
  emptySequenceGraph,
  addParticipant,
  setParticipantDisplay,
  deleteParticipant,
  addMessage,
  setMessageText,
  setMessageStyle,
  deleteMessage,
  addNote,
  setNoteText,
  setNotePosition,
  deleteNote,
  setParticipantKind,
  setMessageActivation,
  insertEvent,
  addBlock,
  setBlockLabel,
  setBranchLabel,
  setBlockKind,
  addBranch,
  removeBranch,
  removeBlock,
  setAutonumber,
  setTitle,
  setBoxLabel,
  setBoxColor,
  removeBox,
  type SequenceGraph,
} from '../../../src/lib/editor/mermaid-sequence-graph';

(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

let renderN = 0;
async function renderedText(src: string): Promise<string> {
  const { svg } = await mermaid.render(`seqedit${++renderN}`, src);
  const d = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return Array.from(d.querySelectorAll('text')).map((t) => t.textContent).join('|');
}

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
});

function edit(src: string, e: SequenceEdit): string {
  const r = applySequenceEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

// ── What users can type ──────────────────────────────────────────────

const TYPED = ['semi; colon', 'hash # sign', '#59; entity', 'a->b', 'x-->>y', '"latest"B->>A', 'R&D <web> "q"', 'x <b>y</b> &amp; z', 'a #lt; b', 'percent %% c', 'end', 'Ünï 🚀'];

describe('popover text survives serialization and renders as typed', () => {
  for (const text of TYPED) {
    it(`${JSON.stringify(text)} as message, note and participant name`, async () => {
      const g = emptySequenceGraph();
      g.participants.set('A', { id: 'A', display: text });
      g.participants.set('B', { id: 'B', display: '' });
      g.events.push({ kind: 'message', from: 'A', to: 'B', text, style: 'arrow' });
      g.events.push({ kind: 'note', participants: ['B'], position: 'over', text });
      const src = serializeSequence(g);

      // The popover reads back exactly what was typed.
      const back = parseSequence(src);
      expect(back.ok, src).toBe(true);
      if (!back.ok) return;
      expect(back.graph.participants.get('A')?.display).toBe(text);
      expect(back.graph.events.map((e) => e.text)).toEqual([text, text]);

      // mermaid draws exactly what was typed: participant box (top and
      // bottom), the message, the note.
      const drawn = (await renderedText(src)).split('|');
      expect(drawn.filter((t) => t === text).length, `${src}\n=> ${drawn.join(' | ')}`).toBe(4);
    });
  }

  it('turns newlines into spaces (each statement is one line)', () => {
    const g = emptySequenceGraph();
    g.participants.set('A', { id: 'A', display: '' });
    g.events.push({ kind: 'message', from: 'A', to: 'A', text: 'one\ntwo', style: 'arrow' });
    expect(serializeSequence(g)).toBe('sequenceDiagram\nparticipant A\nA->>A: one two\n');
  });
});

describe('sequence edits: targeted examples', () => {
  const SRC = [
    'sequenceDiagram',
    '    %% comment inside an editable sequence',
    '    participant A as Alice',
    '    participant B as Bob',
    '    A->>B: Map x->y and back',
    '',
    '    B-->>A: Done',
  ].join('\n');

  it('editing one message leaves the others (and comments) byte-identical', () => {
    expect(edit(SRC, { kind: 'setMessageText', index: 1, text: 'Done!' })).toBe(SRC.replace('B-->>A: Done', 'B-->>A: Done!'));
  });

  it('style changes splice only the arrow', () => {
    expect(edit(SRC, { kind: 'setMessageStyle', index: 0, style: 'dotted' })).toBe(
      SRC.replace('A->>B: Map', 'A-->B: Map'),
    );
  });

  it('adds and removes message text', () => {
    const src = 'sequenceDiagram\n  A->>B\n  B->>A: bye\n';
    expect(edit(src, { kind: 'setMessageText', index: 0, text: 'hi; there' })).toBe(
      'sequenceDiagram\n  A->>B: hi#59; there\n  B->>A: bye\n',
    );
    // An empty label keeps its colon: `A->>B` alone is a mermaid parse error.
    expect(edit(src, { kind: 'setMessageText', index: 1, text: '' })).toBe('sequenceDiagram\n  A->>B\n  B->>A:\n');
  });

  it('renames a declared participant in its declaration only', () => {
    expect(edit(SRC, { kind: 'setParticipantDisplay', id: 'B', display: 'Robert' })).toBe(
      SRC.replace('participant B as Bob', 'participant B as Robert'),
    );
    expect(edit(SRC, { kind: 'setParticipantDisplay', id: 'B', display: '' })).toBe(
      SRC.replace('participant B as Bob', 'participant B'),
    );
  });

  it('declares an implicit participant just before it first appears, keeping the order', () => {
    const src = 'sequenceDiagram\n    %% c\n    A->>B: hi\n';
    expect(edit(src, { kind: 'setParticipantDisplay', id: 'B', display: 'Bob' })).toBe(
      'sequenceDiagram\n    %% c\n    participant A\n    participant B as Bob\n    A->>B: hi\n',
    );
  });

  it('renames via the last aliased declaration (the one mermaid shows)', () => {
    const src = 'sequenceDiagram\nparticipant A as One\nparticipant A as Two\nA->>A: x\n';
    expect(parseSequence(src).ok && (parseSequence(src) as { graph: SequenceGraph }).graph.participants.get('A')?.display).toBe('Two');
    expect(edit(src, { kind: 'setParticipantDisplay', id: 'A', display: 'Three' })).toBe(
      'sequenceDiagram\nparticipant A as One\nparticipant A as Three\nA->>A: x\n',
    );
  });

  it('deleting a participant removes only its lines', () => {
    expect(edit(SRC, { kind: 'deleteParticipant', id: 'B' })).toBe(
      'sequenceDiagram\n    %% comment inside an editable sequence\n    participant A as Alice\n',
    );
  });

  it('inserts "+ after" messages right below their sibling', () => {
    const r = applySequenceEdit(SRC, { kind: 'addMessage', from: 'A', to: 'B', text: '', style: 'arrow', afterIndex: 0 })!;
    expect(r.index).toBe(1);
    expect(r.source).toBe(SRC.replace('Map x->y and back', 'Map x->y and back\n    A->>B:'));
  });

  it('appends new messages and notes after the last statement', () => {
    expect(edit(SRC + '\n    %% tail\n', { kind: 'addNote', participants: ['A'], position: 'leftOf', text: '' })).toBe(
      SRC + '\n    Note left of A: \n    %% tail\n',
    );
  });

  it('adds a participant next to the last one', () => {
    const r = applySequenceEdit(SRC, { kind: 'addParticipant', display: '' })!;
    expect(r.id).toBe('C');
    expect(r.source).toBe(SRC.replace('participant B as Bob', 'participant B as Bob\n    participant C'));
    const empty = applySequenceEdit('sequenceDiagram\n', { kind: 'addParticipant', display: '' })!;
    expect(empty.source).toBe('sequenceDiagram\n    participant A\n');
  });

  it('moves a note by rewriting only its head', () => {
    const src = 'sequenceDiagram\n  participant A\n  participant B\n  Note over A: keep #59; this\n';
    expect(edit(src, { kind: 'setNotePosition', index: 0, participants: ['A', 'B'], position: 'over' })).toBe(
      'sequenceDiagram\n  participant A\n  participant B\n  Note over A,B: keep #59; this\n',
    );
    expect(edit(src, { kind: 'setNotePosition', index: 0, participants: ['B'], position: 'rightOf' })).toBe(
      'sequenceDiagram\n  participant A\n  participant B\n  Note right of B: keep #59; this\n',
    );
  });

  // Review finding: a `# comment` after the text (mermaid ignores it)
  // was swallowed by text edits.
  it('keeps a trailing # comment when the text changes', async () => {
    const src = 'sequenceDiagram\n  participant A as Al # who\n  A->>B: two # todo\n  Note over A: n1 # later\n';
    expect(edit(src, { kind: 'setMessageText', index: 0, text: 'two!' })).toBe(src.replace('two # todo', 'two! # todo'));
    const cleared = edit(src, { kind: 'setMessageText', index: 0, text: '' });
    expect(cleared).toBe(src.replace('A->>B: two # todo', 'A->>B: # todo'));
    await expect(mermaid.parse(cleared)).resolves.toBeTruthy();
    expect(edit(src, { kind: 'setNoteText', index: 1, text: 'n2' })).toBe(src.replace('n1 # later', 'n2 # later'));
    expect(edit(src, { kind: 'setParticipantDisplay', id: 'A', display: 'Bob' })).toBe(src.replace('Al # who', 'Bob # who'));
  });

  it('refuses sources it cannot read', () => {
    // An unencoded `;` is a statement separator to mermaid.
    expect(applySequenceEdit('sequenceDiagram\n  A->>B: y; B->>A: z\n', { kind: 'deleteMessage', index: 0 })).toBeNull();
  });
});

describe('sequence edits: actors, activations, numbering, title', () => {
  it('switches a participant to an actor (and back) on its declarations only', () => {
    const src = 'sequenceDiagram\n    participant A as Alice\n    A->>B: hi\n';
    expect(edit(src, { kind: 'setParticipantKind', id: 'A', participantKind: 'actor' })).toBe(src.replace('participant A', 'actor A'));
    expect(edit(src, { kind: 'setParticipantKind', id: 'B', participantKind: 'actor' })).toBe(
      'sequenceDiagram\n    participant A as Alice\n    actor B\n    A->>B: hi\n',
    );
    expect(parseSequence(edit(src, { kind: 'setParticipantKind', id: 'A', participantKind: 'actor' }))).toMatchObject({
      graph: { participants: new Map([['A', { id: 'A', display: 'Alice', kind: 'actor' }], ['B', { id: 'B', display: '' }]]) },
    });
  });

  it('every arrow kind can be chosen', () => {
    const src = 'sequenceDiagram\n  A->>B: hi\n';
    const want: Record<string, string> = {
      solid: '->', arrow: '->>', dotted: '-->', reply: '-->>', cross: '-x', dottedCross: '--x', async: '-)',
      dottedAsync: '--)', both: '<<->>', dottedBoth: '<<-->>',
    };
    for (const [style, delim] of Object.entries(want)) {
      expect(edit(src, { kind: 'setMessageStyle', index: 0, style: style as never })).toBe(`sequenceDiagram\n  A${delim}B: hi\n`);
    }
  });

  it('activation: a mark after the arrow, kept when the arrow changes', () => {
    const src = 'sequenceDiagram\n  A->>B: work\n  B-->>A: done\n';
    const on = edit(src, { kind: 'setMessageActivation', index: 0, activation: 'activate' });
    expect(on).toBe('sequenceDiagram\n  A->>+B: work\n  B-->>A: done\n');
    const both = edit(on, { kind: 'setMessageActivation', index: 1, activation: 'deactivate' });
    expect(both).toBe('sequenceDiagram\n  A->>+B: work\n  B-->>-A: done\n');
    expect(edit(both, { kind: 'setMessageStyle', index: 0, style: 'dotted' })).toBe('sequenceDiagram\n  A-->+B: work\n  B-->>-A: done\n');
  });

  it('removing an activation takes the deactivation that would end nothing with it', async () => {
    const src = 'sequenceDiagram\n  A->>+B: work\n  B-->>-A: done\n  A->>B: again\n';
    const off = edit(src, { kind: 'setMessageActivation', index: 0, activation: null });
    expect(off).toBe('sequenceDiagram\n  A->>B: work\n  B-->>A: done\n  A->>B: again\n');
    const explicit = 'sequenceDiagram\n  A->>B: work\n  activate B\n  B-->>A: done\n  deactivate B\n';
    // B keeps its place; its own activate / deactivate pair is still whole.
    expect(edit(explicit, { kind: 'deleteParticipant', id: 'A' })).toBe('sequenceDiagram\n  participant B\n  activate B\n  deactivate B\n');
    const del = edit(src, { kind: 'deleteMessage', index: 0 });
    // A and B first appeared in the removed line: declared there now.
    expect(del).toBe('sequenceDiagram\n  participant A\n  participant B\n  B-->>A: done\n  A->>B: again\n');
    await expect(mermaid.parse(del)).resolves.toBeTruthy();
  });

  it('autonumber on / off', () => {
    const src = 'sequenceDiagram\n    participant A\n    A->>B: x\n';
    const on = edit(src, { kind: 'setAutonumber', on: true });
    expect(on).toBe('sequenceDiagram\n    autonumber\n    participant A\n    A->>B: x\n');
    expect(edit(on, { kind: 'setAutonumber', on: false })).toBe(src);
  });

  it('title: set, change, remove', () => {
    const src = 'sequenceDiagram\n    A->>B: x\n';
    const t = edit(src, { kind: 'setTitle', title: 'Checkout; v2' });
    expect(t).toBe('sequenceDiagram\n    title Checkout#59; v2\n    A->>B: x\n');
    expect(parseSequence(t)).toMatchObject({ graph: { title: 'Checkout; v2' } });
    expect(edit(t, { kind: 'setTitle', title: '' })).toBe(src);
  });
});

describe('sequence edits: blocks', () => {
  const SRC = [
    'sequenceDiagram',
    '    participant C',
    '    participant S',
    '    C->>S: one',
    '    C->>S: two',
    '    %% keep',
    '    alt ok',
    '        S-->>C: yes',
    '    else not ok',
    '        S-->>C: no',
    '    end',
  ].join('\n');

  it('wraps messages in a block, leaving them as they were', () => {
    const r = applySequenceEdit(SRC, { kind: 'addBlock', blockKind: 'loop', label: 'Every minute', start: 0, end: 2 })!;
    expect(r.index).toBe(0);
    expect(r.source).toBe(SRC.replace('    C->>S: one\n    C->>S: two\n', '    loop Every minute\n    C->>S: one\n    C->>S: two\n    end\n'));
    const g = parseSequence(r.source);
    expect(g.ok && g.graph.blocks.map((b) => [b.kind, b.label, b.start, b.end])).toEqual([['loop', 'Every minute', 0, 2], ['alt', 'ok', 2, 4]]);
  });

  it('refuses to wrap across a block boundary', () => {
    expect(applySequenceEdit(SRC, { kind: 'addBlock', blockKind: 'opt', label: 'x', start: 1, end: 3 })).toBeNull();
    expect(applySequenceEdit(SRC, { kind: 'addBlock', blockKind: 'opt', label: 'x', start: 2, end: 4 })).toBeNull();
    // Inside one branch is fine.
    expect(applySequenceEdit(SRC, { kind: 'addBlock', blockKind: 'opt', label: 'x', start: 3, end: 4 })).not.toBeNull();
  });

  it('edits labels, kinds and branches', () => {
    expect(edit(SRC, { kind: 'setBlockLabel', block: 0, label: 'success' })).toBe(SRC.replace('alt ok', 'alt success'));
    expect(edit(SRC, { kind: 'setBranchLabel', block: 0, branch: 0, label: 'failure' })).toBe(SRC.replace('else not ok', 'else failure'));
    expect(edit(SRC, { kind: 'setBlockKind', block: 0, blockKind: 'par' })).toBe(SRC.replace('alt ok', 'par ok').replace('else not ok', 'and not ok'));
    expect(applySequenceEdit(SRC, { kind: 'setBlockKind', block: 0, blockKind: 'loop' })).toBeNull();
    expect(edit(SRC, { kind: 'addBranch', block: 0, label: 'maybe' })).toBe(SRC.replace('        S-->>C: no\n    end', '        S-->>C: no\n    else maybe\n    end'));
    expect(edit(SRC, { kind: 'removeBranch', block: 0, branch: 0 })).toBe(SRC.replace('    else not ok\n', ''));
  });

  it('removing a block keeps what was inside', () => {
    expect(edit(SRC, { kind: 'removeBlock', block: 0 })).toBe(SRC.replace('    alt ok\n', '').replace('    else not ok\n', '').replace('\n    end', ''));
  });

  it('a message added after one inside a block stays in that block branch', () => {
    const r = applySequenceEdit(SRC, { kind: 'addMessage', from: 'S', to: 'C', text: '', style: 'reply', afterIndex: 2 })!;
    expect(r.source).toBe(SRC.replace('        S-->>C: yes\n', '        S-->>C: yes\n        S-->>C:\n'));
    const g = parseSequence(r.source);
    expect(g.ok && g.graph.blocks[0]).toMatchObject({ start: 2, end: 5, branchStarts: [4] });
  });
});

describe('sequence edits: boxes', () => {
  const SRC = 'sequenceDiagram\n    box Purple Front end\n    participant A\n    end\n    box Back\n    participant B\n    end\n    A->>B: x\n';

  it('renames and recolours a box', () => {
    expect(edit(SRC, { kind: 'setBoxLabel', box: 0, label: 'Client side' })).toBe(SRC.replace('box Purple Front end', 'box Purple Client side'));
    expect(edit(SRC, { kind: 'setBoxColor', box: 1, color: '#bfdbfe' })).toBe(SRC.replace('box Back', 'box #bfdbfe Back'));
    expect(edit(SRC, { kind: 'setBoxColor', box: 0, color: null })).toBe(SRC.replace('box Purple Front end', 'box Front end'));
    // A label starting with a colour name keeps a colour in front, so
    // it reads as a label.
    expect(edit(SRC, { kind: 'setBoxLabel', box: 1, label: 'Red team' })).toBe(SRC.replace('box Back', 'box transparent Red team'));
    expect(parseSequence(edit(SRC, { kind: 'setBoxLabel', box: 1, label: 'Red team' }))).toMatchObject({ graph: { boxes: [{}, { label: 'Red team', color: 'transparent' }] } });
  });

  it('removing a box keeps its participants', () => {
    expect(edit(SRC, { kind: 'removeBox', box: 0 })).toBe(SRC.replace('    box Purple Front end\n', '').replace('    participant A\n    end\n', '    participant A\n'));
  });
});

// ── Property test over the corpora ───────────────────────────────────

const BLOCKS = [
  ...corpusBlocks((b) => detectDiagramType(b.source) === 'sequence' && parseSequence(b.source).ok),
  ...corpusBlocks((b) => detectDiagramType(b.source) === 'sequence', ['mermaid-corpus-sequence.md']),
];

const TRICKY = 'Renamed; #59; x->y "q" end';

interface Op {
  name: string;
  edit: SequenceEdit;
  expected: (g: SequenceGraph) => SequenceGraph;
  touches: string[] | 'none';
  // Lines (by pattern) the op may rewrite besides those naming `touches`.
  lines?: RegExp;
  // Deleting can drop activation marks that end nothing any more.
  anyActivation?: boolean;
}

function opsFor(g: SequenceGraph): Op[] {
  const ops: Op[] = [];
  const ids = Array.from(g.participants.keys());
  for (const id of ids) {
    ops.push({ name: `display ${id}`, edit: { kind: 'setParticipantDisplay', id, display: TRICKY }, expected: (x) => setParticipantDisplay(x, id, TRICKY), touches: [id] });
    const kind = g.participants.get(id)!.kind === 'actor' ? 'participant' : 'actor';
    ops.push({ name: `kind ${id}`, edit: { kind: 'setParticipantKind', id, participantKind: kind }, expected: (x) => setParticipantKind(x, id, kind), touches: [id] });
    ops.push({ name: `delete ${id}`, edit: { kind: 'deleteParticipant', id }, expected: (x) => deleteParticipant(x, id), touches: [id], lines: /^\s*(box\b|end\s*$|deactivate\s|create\s|destroy\s)/, anyActivation: true });
  }
  g.events.forEach((ev, index) => {
    const who = ev.kind === 'message' ? [ev.from, ev.to] : ev.participants;
    if (ev.kind === 'message') {
      ops.push({ name: `msg text ${index}`, edit: { kind: 'setMessageText', index, text: TRICKY }, expected: (x) => setMessageText(x, index, TRICKY), touches: who });
      for (const style of ['solid', 'cross', 'dottedAsync', 'both'] as const) {
        ops.push({ name: `msg style ${style} ${index}`, edit: { kind: 'setMessageStyle', index, style }, expected: (x) => setMessageStyle(x, index, style), touches: who });
      }
      if (!ev.activation && ev.from !== ev.to) {
        ops.push({ name: `msg activate ${index}`, edit: { kind: 'setMessageActivation', index, activation: 'activate' }, expected: (x) => setMessageActivation(x, index, 'activate'), touches: who });
      }
      if (ev.activation) {
        ops.push({ name: `msg no activation ${index}`, edit: { kind: 'setMessageActivation', index, activation: null }, expected: (x) => setMessageActivation(x, index, null), touches: who, anyActivation: true, lines: /^\s*deactivate\s/ });
      }
      ops.push({ name: `msg delete ${index}`, edit: { kind: 'deleteMessage', index }, expected: (x) => deleteMessage(x, index), touches: who, anyActivation: true, lines: /^\s*(deactivate|create|destroy)\s/ });
      ops.push({
        name: `msg after ${index}`,
        edit: { kind: 'addMessage', from: ev.from, to: ev.to, text: '', style: ev.style === 'other' ? 'arrow' : ev.style, afterIndex: index },
        expected: (x) => insertEvent(x, index + 1, { kind: 'message', from: ev.from, to: ev.to, text: '', style: ev.style === 'other' ? 'arrow' : ev.style }, blockOf(x, index)),
        touches: 'none',
      });
    } else {
      ops.push({ name: `note text ${index}`, edit: { kind: 'setNoteText', index, text: TRICKY }, expected: (x) => setNoteText(x, index, TRICKY), touches: who });
      const spec = { participants: [ids[0]], position: 'rightOf' as const };
      ops.push({ name: `note move ${index}`, edit: { kind: 'setNotePosition', index, ...spec }, expected: (x) => setNotePosition(x, index, spec), touches: who });
      ops.push({ name: `note delete ${index}`, edit: { kind: 'deleteNote', index }, expected: (x) => deleteNote(x, index), touches: who });
    }
    // Wrap this one event in a block.
    ops.push({
      name: `wrap ${index}`,
      edit: { kind: 'addBlock', blockKind: 'opt', label: 'Maybe', start: index, end: index + 1 },
      expected: (x) => addBlock(x, 'opt', 'Maybe', index, index + 1).graph,
      touches: 'none',
    });
  });
  g.blocks.forEach((b, block) => {
    const kw = new RegExp(`^\\s*(${b.kind}|par_over|else|and|option|end)\\b`);
    if (b.kind !== 'rect') {
      ops.push({ name: `block label ${block}`, edit: { kind: 'setBlockLabel', block, label: TRICKY }, expected: (x) => setBlockLabel(x, block, TRICKY), touches: 'none', lines: kw });
    }
    b.branches.forEach((_, branch) => {
      ops.push({ name: `branch label ${block}.${branch}`, edit: { kind: 'setBranchLabel', block, branch, label: 'Other way' }, expected: (x) => setBranchLabel(x, block, branch, 'Other way'), touches: 'none', lines: kw });
      ops.push({ name: `branch remove ${block}.${branch}`, edit: { kind: 'removeBranch', block, branch }, expected: (x) => removeBranch(x, block, branch), touches: 'none', lines: kw });
    });
    if (b.kind === 'alt' || b.kind === 'par' || b.kind === 'critical') {
      ops.push({ name: `branch add ${block}`, edit: { kind: 'addBranch', block, label: 'Third' }, expected: (x) => addBranch(x, block, 'Third'), touches: 'none' });
      const other = b.kind === 'alt' ? 'critical' : 'alt';
      ops.push({ name: `block kind ${block}`, edit: { kind: 'setBlockKind', block, blockKind: other }, expected: (x) => setBlockKind(x, block, other), touches: 'none', lines: kw });
    } else if (b.kind !== 'rect') {
      const other = b.kind === 'loop' ? 'break' : 'loop';
      ops.push({ name: `block kind ${block}`, edit: { kind: 'setBlockKind', block, blockKind: other }, expected: (x) => setBlockKind(x, block, other), touches: 'none', lines: kw });
    }
    ops.push({ name: `block remove ${block}`, edit: { kind: 'removeBlock', block }, expected: (x) => removeBlock(x, block), touches: 'none', lines: kw });
  });
  g.boxes.forEach((_, box) => {
    ops.push({ name: `box label ${box}`, edit: { kind: 'setBoxLabel', box, label: 'Area 51' }, expected: (x) => setBoxLabel(x, box, 'Area 51'), touches: 'none', lines: /^\s*box\b/ });
    ops.push({ name: `box colour ${box}`, edit: { kind: 'setBoxColor', box, color: '#e9d5ff' }, expected: (x) => setBoxColor(x, box, '#e9d5ff'), touches: 'none', lines: /^\s*box\b/ });
    ops.push({ name: `box remove ${box}`, edit: { kind: 'removeBox', box }, expected: (x) => removeBox(x, box), touches: 'none', lines: /^\s*(box\b|end\s*$)/ });
  });
  ops.push({ name: 'autonumber toggle', edit: { kind: 'setAutonumber', on: !g.autonumber }, expected: (x) => setAutonumber(x, !g.autonumber), touches: 'none', lines: /^\s*autonumber\b/ });
  ops.push({ name: 'title', edit: { kind: 'setTitle', title: 'A; title' }, expected: (x) => setTitle(x, 'A; title'), touches: 'none', lines: /^\s*title\b/ });
  ops.push({ name: 'add participant', edit: { kind: 'addParticipant', display: '' }, expected: (x) => addParticipant(x, { display: '' }).graph, touches: 'none' });
  if (ids.length >= 2) {
    ops.push({
      name: 'add message',
      edit: { kind: 'addMessage', from: ids[0], to: ids[1], text: '', style: 'arrow' },
      expected: (x) => addMessage(x, { from: ids[0], to: ids[1], text: '', style: 'arrow' }),
      touches: 'none',
    });
  }
  if (ids.length) {
    ops.push({
      name: 'add note',
      edit: { kind: 'addNote', participants: [ids[0]], position: 'leftOf', text: '' },
      expected: (x) => addNote(x, { participants: [ids[0]], position: 'leftOf', text: '' }),
      touches: 'none',
    });
  }
  return ops;
}

// Lines of source whose statement names one of ids (a plain word
// match misses C-xS).
function linesNaming(source: string, ids: string[]): Set<string> {
  const r = parseSequenceSource(source);
  const out = new Set<string>();
  if (!r.ok) return out;
  const { graph, map } = r;
  graph.events.forEach((ev, i) => {
    const who = ev.kind === 'message' ? [ev.from, ev.to] : ev.participants;
    if (who.some((w) => ids.includes(w))) out.add(map.lines[map.events[i].line]);
  });
  for (const id of ids) for (const d of map.declarations.get(id) ?? []) out.add(map.lines[d.line]);
  for (const ref of map.references) if (ids.includes(ref.id)) out.add(map.lines[ref.line]);
  return out;
}

// The innermost block an event sits in.
function blockOf(g: SequenceGraph, index: number): number | null {
  let best: number | null = null;
  g.blocks.forEach((b, i) => {
    if (b.start <= index && index < b.end && (best === null || b.start >= g.blocks[best].start)) best = i;
  });
  return best;
}

const shape = (g: SequenceGraph, anyActivation: boolean) => ({
  participants: Array.from(g.participants.entries()),
  events: anyActivation ? g.events.map((e) => (e.kind === 'message' ? { ...e, activation: undefined } : e)) : g.events,
  blocks: g.blocks,
  boxes: g.boxes,
  autonumber: g.autonumber,
  title: g.title,
});

describe('sequence edits: corpus property', () => {
  beforeAll(() => {
    const named = new Set(['purple', 'lightyellow', 'red', 'transparent']);
    (window.CSS as unknown as Record<string, unknown>).supports = (_p: string, v: string) =>
      /^(rgba?|hsla?)\(/i.test(v) || /^#[0-9a-f]{3,8}$/i.test(v) || named.has(String(v).toLowerCase());
  });

  it('finds editable sequence diagrams in the corpora', () => {
    expect(BLOCKS.length).toBeGreaterThanOrEqual(17);
  });

  for (const block of BLOCKS) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const parsed = parseSequence(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      for (const op of opsFor(parsed.graph)) {
        const res = applySequenceEdit(block.source, op.edit);
        expect(res, op.name).not.toBeNull();
        const out = res!.source;
        const naming = op.touches === 'none' ? new Set<string>() : linesNaming(block.source, op.touches);
        const back = parseSequence(out);
        expect(back.ok, `${op.name}: own output unparseable:\n${out}`).toBe(true);
        if (!back.ok) continue;
        expect(shape(back.graph, !!op.anyActivation), `${op.name}:\n${out}`).toEqual(shape(op.expected(parsed.graph), !!op.anyActivation));
        for (const line of removedLines(block.source, out)) {
          const allowed = (op.touches !== 'none' && naming.has(line)) || (!!op.lines && op.lines.test(line));
          expect(allowed, `${op.name} changed an unrelated line ${JSON.stringify(line)}:\n${out}`).toBe(true);
        }
        try {
          await mermaid.parse(out);
        } catch (e) {
          throw new Error(`${op.name}: mermaid rejects it (${(e as Error).message.split('\n')[0]}):\n${out}`);
        }
      }
    }, 60_000);
  }
});
