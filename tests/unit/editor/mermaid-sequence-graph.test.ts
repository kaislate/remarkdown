import { describe, it, expect } from 'vitest';
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
} from '../../../src/lib/editor/mermaid-sequence-graph';

describe('sequence graph', () => {
  it('emptySequenceGraph yields no participants and no events', () => {
    const g = emptySequenceGraph();
    expect(g.participants.size).toBe(0);
    expect(g.events.length).toBe(0);
  });

  it('addParticipant produces a fresh id and stores the participant', () => {
    const g0 = emptySequenceGraph();
    const { graph: g1, id } = addParticipant(g0, { display: 'Alice' });
    expect(g1.participants.size).toBe(1);
    expect(g1.participants.get(id)?.display).toBe('Alice');
  });

  it('addParticipant ids follow A, B, ..., Z, AA, ...', () => {
    let g = emptySequenceGraph();
    const ids: string[] = [];
    for (let i = 0; i < 27; i++) {
      const r = addParticipant(g, { display: `p${i}` });
      g = r.graph;
      ids.push(r.id);
    }
    expect(ids[0]).toBe('A');
    expect(ids[25]).toBe('Z');
    expect(ids[26]).toBe('AA');
  });

  it('addMessage appends a message event', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'Alice' }); g = a.graph;
    const b = addParticipant(g, { display: 'Bob' }); g = b.graph;
    g = addMessage(g, { from: a.id, to: b.id, text: 'Hello', style: 'arrow' });
    expect(g.events).toHaveLength(1);
    expect(g.events[0]).toEqual({
      kind: 'message',
      from: a.id,
      to: b.id,
      text: 'Hello',
      style: 'arrow',
    });
  });

  it('addNote appends a note event', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'Alice' }); g = a.graph;
    g = addNote(g, { participants: [a.id], position: 'rightOf', text: 'A note' });
    expect(g.events).toHaveLength(1);
    expect(g.events[0]).toEqual({
      kind: 'note',
      participants: [a.id],
      position: 'rightOf',
      text: 'A note',
    });
  });

  it('setMessageText / setMessageStyle / setNoteText / setNotePosition update the right event', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addMessage(g, { from: a.id, to: b.id, text: '', style: 'arrow' });
    g = addNote(g, { participants: [a.id], position: 'rightOf', text: '' });
    g = setMessageText(g, 0, 'hi');
    g = setMessageStyle(g, 0, 'reply');
    g = setNoteText(g, 1, 'note text');
    g = setNotePosition(g, 1, { participants: [a.id, b.id], position: 'over' });
    const msg = g.events[0];
    const note = g.events[1];
    expect(msg.kind === 'message' && msg.text).toBe('hi');
    expect(msg.kind === 'message' && msg.style).toBe('reply');
    expect(note.kind === 'note' && note.text).toBe('note text');
    expect(note.kind === 'note' && note.position).toBe('over');
    expect(note.kind === 'note' && note.participants).toEqual([a.id, b.id]);
  });

  it('deleteParticipant cascades to remove all events that reference it', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    const c = addParticipant(g, { display: 'C' }); g = c.graph;
    g = addMessage(g, { from: a.id, to: b.id, text: '', style: 'arrow' });
    g = addMessage(g, { from: b.id, to: c.id, text: '', style: 'arrow' });
    g = addNote(g, { participants: [b.id], position: 'rightOf', text: '' });
    g = addNote(g, { participants: [a.id, c.id], position: 'over', text: '' });
    g = deleteParticipant(g, b.id);
    expect(g.participants.has(b.id)).toBe(false);
    // Both messages touched B; note over A,C does NOT touch B.
    expect(g.events).toHaveLength(1);
    const remaining = g.events[0];
    expect(remaining.kind).toBe('note');
  });

  it('deleteMessage / deleteNote remove by index in events[]', () => {
    let g = emptySequenceGraph();
    const a = addParticipant(g, { display: 'A' }); g = a.graph;
    const b = addParticipant(g, { display: 'B' }); g = b.graph;
    g = addMessage(g, { from: a.id, to: b.id, text: 'one', style: 'arrow' });
    g = addNote(g, { participants: [a.id], position: 'rightOf', text: 'note' });
    g = addMessage(g, { from: b.id, to: a.id, text: 'two', style: 'reply' });
    expect(g.events).toHaveLength(3);
    g = deleteMessage(g, 0); // removes first message
    expect(g.events).toHaveLength(2);
    expect(g.events[0].kind).toBe('note');
    g = deleteNote(g, 0); // removes the note (now at index 0)
    expect(g.events).toHaveLength(1);
    const last = g.events[0];
    expect(last.kind === 'message' && last.text).toBe('two');
  });
});
