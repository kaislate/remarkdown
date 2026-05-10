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
    expect(serializeSequence(g)).toBe(
      'sequenceDiagram\nparticipant A as A\nparticipant B as B\n' +
      'A->B\nA->>B\nA-->B\nA-->>B\n',
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
    expect(out).toContain('\nB-->>A\n');
    // Confirm: every non-empty line is exactly one statement.
    const lines = out.split('\n').filter(Boolean);
    expect(lines).toEqual([
      'sequenceDiagram',
      'participant A as A',
      'participant B as B',
      'A->>B: line one line two',
      'B-->>A',
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

  // Defense in depth: if a text field somehow accumulates a glued
  // statement (we've seen "X->>Y" appear inside a message text in the
  // wild without being able to reproduce the upstream mutation),
  // truncate at the glue point so mermaid can still render the line.
  it('truncates message text at an embedded arrow statement', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addMessage(g, {
      from: a.id,
      to: b.id,
      text: '"latest update available"B->>A',
      style: 'arrow',
    });
    g = addMessage(g, { from: b.id, to: a.id, text: '', style: 'reply' });
    const out = serializeSequence(g);
    // First message keeps the visible text up to the glue; the trailing
    // arrow-shaped substring is dropped. Second message renders cleanly
    // on its own line.
    expect(out).toContain('A->>B: "latest update available"\n');
    expect(out).toContain('\nB-->>A\n');
    const lines = out.split('\n').filter(Boolean);
    expect(lines).toEqual([
      'sequenceDiagram',
      'participant A as A',
      'participant B as B',
      'A->>B: "latest update available"',
      'B-->>A',
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
