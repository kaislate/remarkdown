import { describe, it, expect } from 'vitest';
import {
  emptySequenceGraph,
  addParticipant,
  addMessage,
  addNote,
} from '../../../src/lib/editor/mermaid-sequence-graph';
import { serializeSequence } from '../../../src/lib/editor/mermaid-sequence-serializer';

describe('sequence serializer', () => {
  it('emits the directive on an empty graph', () => {
    expect(serializeSequence(emptySequenceGraph())).toBe('sequenceDiagram\n');
  });

  it('emits a participant without display', () => {
    let g = emptySequenceGraph();
    g = addParticipant(g, { display: '' }).graph;
    expect(serializeSequence(g)).toBe('sequenceDiagram\nparticipant A\n');
  });

  it('emits a participant with display via "as"', () => {
    let g = emptySequenceGraph();
    g = addParticipant(g, { display: 'Alice' }).graph;
    expect(serializeSequence(g)).toBe(
      'sequenceDiagram\nparticipant A as Alice\n',
    );
  });

  it('emits each message style correctly', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addMessage(g, { from: a.id, to: b.id, text: '', style: 'solid' });
    g = addMessage(g, { from: a.id, to: b.id, text: '', style: 'arrow' });
    g = addMessage(g, { from: a.id, to: b.id, text: '', style: 'dotted' });
    g = addMessage(g, { from: a.id, to: b.id, text: '', style: 'reply' });
    // Empty text still gets its colon — mermaid 11 rejects `A->B` alone.
    expect(serializeSequence(g)).toBe(
      'sequenceDiagram\nparticipant A as A\nparticipant B as B\n' +
      'A->B:\nA->>B:\nA-->B:\nA-->>B:\n',
    );
  });

  it('emits messages with text after a colon', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addMessage(g, { from: a.id, to: b.id, text: 'Hello', style: 'arrow' });
    expect(serializeSequence(g)).toBe(
      'sequenceDiagram\nparticipant A as A\nparticipant B as B\n' +
      'A->>B: Hello\n',
    );
  });

  it('emits each note position', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addNote(g, { participants: [a.id], position: 'leftOf', text: 'L' });
    g = addNote(g, { participants: [a.id], position: 'rightOf', text: 'R' });
    g = addNote(g, { participants: [a.id, b.id], position: 'over', text: 'O' });
    g = addNote(g, { participants: [a.id], position: 'over', text: 'single' });
    expect(serializeSequence(g)).toBe(
      'sequenceDiagram\nparticipant A as A\nparticipant B as B\n' +
      'Note left of A: L\nNote right of A: R\nNote over A,B: O\nNote over A: single\n',
    );
  });

  it('emits events in the order they were added', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addMessage(g, { from: a.id, to: b.id, text: 'first', style: 'arrow' });
    g = addNote(g, { participants: [b.id], position: 'rightOf', text: 'a note' });
    g = addMessage(g, { from: b.id, to: a.id, text: 'second', style: 'reply' });
    expect(serializeSequence(g)).toBe(
      'sequenceDiagram\nparticipant A as A\nparticipant B as B\n' +
      'A->>B: first\n' +
      'Note right of B: a note\n' +
      'B-->>A: second\n',
    );
  });

  it('does not emit "as Display" when display is empty', () => {
    let g = emptySequenceGraph();
    g = addParticipant(g, { display: '' }).graph;
    g = addParticipant(g, { display: 'Bob' }).graph;
    expect(serializeSequence(g)).toBe(
      'sequenceDiagram\nparticipant A\nparticipant B as Bob\n',
    );
  });

  // Defensive: text fields must never produce a serialized line break,
  // even if a stray \n leaks into the graph (e.g., paste, future
  // multi-line UI). Without this every event after the offender would
  // be glued to the line below in mermaid's eyes, producing parse
  // errors like "Expecting 'TXT', got 'NEWLINE'".
  it('flattens newlines in message text to spaces', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addMessage(g, { from: a.id, to: b.id, text: 'line one\nline two', style: 'arrow' });
    g = addMessage(g, { from: b.id, to: a.id, text: '', style: 'reply' });
    const out = serializeSequence(g);
    expect(out).toContain('A->>B: line one line two\n');
    expect(out).toContain('\nB-->>A:\n');
    // Confirm: every non-empty line is exactly one statement.
    const lines = out.split('\n').filter(Boolean);
    expect(lines).toEqual([
      'sequenceDiagram',
      'participant A as A',
      'participant B as B',
      'A->>B: line one line two',
      'B-->>A:',
    ]);
  });

  it('flattens newlines in note text to spaces', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    g = addNote(g, { participants: [a.id], position: 'leftOf', text: 'first\nsecond' });
    expect(serializeSequence(g)).toBe(
      'sequenceDiagram\nparticipant A as A\nNote left of A: first second\n',
    );
  });

  it('flattens newlines in participant display to spaces', () => {
    let g = emptySequenceGraph();
    g = addParticipant(g, { display: 'Long\nname' }).graph;
    expect(serializeSequence(g)).toBe(
      'sequenceDiagram\nparticipant A as Long name\n',
    );
  });

  // Text that merely LOOKS like a message statement ("Map x->y", even
  // a glued '"latest"B->>A') is legitimate in mermaid 11.14 — it
  // renders verbatim (see mermaid-sequence-edit.test.ts, which renders
  // it). It used to be truncated at the arrow, corrupting real text.
  it('keeps arrow-shaped text intact', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addMessage(g, {
      from: a.id,
      to: b.id,
      text: '"latest update available"B->>A',
      style: 'arrow',
    });
    g = addMessage(g, { from: b.id, to: a.id, text: 'Map x->y and back', style: 'reply' });
    const lines = serializeSequence(g).split('\n').filter(Boolean);
    expect(lines).toEqual([
      'sequenceDiagram',
      'participant A as A',
      'participant B as B',
      'A->>B: "latest update available"B->>A',
      'B-->>A: Map x->y and back',
    ]);
  });

  // `;` ends a statement and `#` starts a comment in sequence diagrams;
  // both are written as mermaid entity codes so the text shows as typed.
  it('encodes ; and # as entity codes', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'R;D #1' }); g = a.graph;
    g = addMessage(g, { from: a.id, to: a.id, text: 'a; b # c', style: 'arrow' });
    g = addNote(g, { participants: [a.id], position: 'over', text: '#59; literal' });
    expect(serializeSequence(g).split('\n').filter(Boolean)).toEqual([
      'sequenceDiagram',
      'participant A as R#59;D #35;1',
      'A->>A: a#59; b #35; c',
      'Note over A: #35;59#59; literal',
    ]);
  });

  it('keeps text intact when no arrow shape is present', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addMessage(g, {
      from: a.id,
      to: b.id,
      text: 'plain text with - dashes - but no arrow',
      style: 'arrow',
    });
    expect(serializeSequence(g)).toContain(
      'A->>B: plain text with - dashes - but no arrow\n',
    );
  });
});
