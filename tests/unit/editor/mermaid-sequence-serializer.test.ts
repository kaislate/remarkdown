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
});
