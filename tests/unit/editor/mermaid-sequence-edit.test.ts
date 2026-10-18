// Source-preserving visual edits on sequence diagrams, and the text
// encoding that lets users type anything into the popovers.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mermaid from 'mermaid';
import { applySequenceEdit, type SequenceEdit } from '../../../src/lib/editor/mermaid-sequence-edit';
import { parseSequence } from '../../../src/lib/editor/mermaid-sequence-parser';
import { serializeSequence } from '../../../src/lib/editor/mermaid-sequence-serializer';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import { parseMarkdown } from '../../../src/lib/editor/markdown';
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

  it('refuses sources outside the subset', () => {
    expect(applySequenceEdit('sequenceDiagram\n  loop x\n  A->>B: y\n  end\n', { kind: 'deleteMessage', index: 0 })).toBeNull();
  });
});

// ── Property test over the corpus ────────────────────────────────────

const CORPUS = readFileSync(resolve(__dirname, '../../fixtures/mermaid-corpus.md'), 'utf8').replace(/\r\n/g, '\n');

function corpusSequences(): Array<{ heading: string; source: string }> {
  const out: Array<{ heading: string; source: string }> = [];
  let heading = '';
  parseMarkdown(CORPUS).descendants((node) => {
    if (node.type.name === 'heading') heading = node.textContent;
    if (node.type.name === 'code_block' && detectDiagramType(node.textContent) === 'sequence') {
      if (parseSequence(node.textContent).ok) out.push({ heading, source: node.textContent });
    }
    return true;
  });
  return out;
}

const TRICKY = 'Renamed; #59; x->y "q" end';

interface Op {
  name: string;
  edit: SequenceEdit;
  expected: (g: SequenceGraph) => SequenceGraph;
  touches: string[] | 'none';
}

function opsFor(g: SequenceGraph): Op[] {
  const ops: Op[] = [];
  const ids = Array.from(g.participants.keys());
  for (const id of ids) {
    ops.push({ name: `display ${id}`, edit: { kind: 'setParticipantDisplay', id, display: TRICKY }, expected: (x) => setParticipantDisplay(x, id, TRICKY), touches: [id] });
    ops.push({ name: `delete ${id}`, edit: { kind: 'deleteParticipant', id }, expected: (x) => deleteParticipant(x, id), touches: [id] });
  }
  g.events.forEach((ev, index) => {
    const who = ev.kind === 'message' ? [ev.from, ev.to] : ev.participants;
    if (ev.kind === 'message') {
      ops.push({ name: `msg text ${index}`, edit: { kind: 'setMessageText', index, text: TRICKY }, expected: (x) => setMessageText(x, index, TRICKY), touches: who });
      ops.push({ name: `msg style ${index}`, edit: { kind: 'setMessageStyle', index, style: 'solid' }, expected: (x) => setMessageStyle(x, index, 'solid'), touches: who });
      ops.push({ name: `msg delete ${index}`, edit: { kind: 'deleteMessage', index }, expected: (x) => deleteMessage(x, index), touches: who });
      ops.push({
        name: `msg after ${index}`,
        edit: { kind: 'addMessage', from: ev.from, to: ev.to, text: '', style: ev.style, afterIndex: index },
        expected: (x) => {
          const events = [...x.events];
          events.splice(index + 1, 0, { kind: 'message', from: ev.from, to: ev.to, text: '', style: ev.style });
          return { ...x, events };
        },
        touches: 'none',
      });
    } else {
      ops.push({ name: `note text ${index}`, edit: { kind: 'setNoteText', index, text: TRICKY }, expected: (x) => setNoteText(x, index, TRICKY), touches: who });
      const spec = { participants: [ids[0]], position: 'rightOf' as const };
      ops.push({ name: `note move ${index}`, edit: { kind: 'setNotePosition', index, ...spec }, expected: (x) => setNotePosition(x, index, spec), touches: who });
      ops.push({ name: `note delete ${index}`, edit: { kind: 'deleteNote', index }, expected: (x) => deleteNote(x, index), touches: who });
    }
  });
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

function removedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(a[i++]); else j++;
  }
  while (i < a.length) out.push(a[i++]);
  return out;
}

const mentions = (line: string, id: string) => new RegExp(`(^|[^A-Za-z0-9_])${id}([^A-Za-z0-9_]|$)`).test(line);
const shape = (g: SequenceGraph) => ({ participants: Array.from(g.participants.entries()), events: g.events });

describe('sequence edits: corpus property', () => {
  const blocks = corpusSequences();
  it('finds editable sequence diagrams in the corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(5);
  });

  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const parsed = parseSequence(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      for (const op of opsFor(parsed.graph)) {
        const res = applySequenceEdit(block.source, op.edit);
        expect(res, op.name).not.toBeNull();
        const out = res!.source;
        const back = parseSequence(out);
        expect(back.ok, `${op.name}: own output unparseable:\n${out}`).toBe(true);
        if (!back.ok) continue;
        expect(shape(back.graph), `${op.name}:\n${out}`).toEqual(shape(op.expected(parsed.graph)));
        for (const line of removedLines(block.source, out)) {
          const allowed = op.touches !== 'none' && op.touches.some((id) => mentions(line, id));
          expect(allowed, `${op.name} changed an unrelated line ${JSON.stringify(line)}:\n${out}`).toBe(true);
        }
        await expect(mermaid.parse(out), `${op.name}:\n${out}`).resolves.toBeTruthy();
      }
    }, 60_000);
  }
});
