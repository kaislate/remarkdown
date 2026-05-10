import { describe, it, expect } from 'vitest';
import { parseSequence } from '../../../src/lib/editor/mermaid-sequence-parser';
import { serializeSequence } from '../../../src/lib/editor/mermaid-sequence-serializer';

function rt(src: string): string {
  const r = parseSequence(src);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return serializeSequence(r.graph);
}

describe('sequence parser — directive', () => {
  it('parses an empty sequenceDiagram', () => {
    const r = parseSequence('sequenceDiagram\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.participants.size).toBe(0);
    expect(r.graph.events.length).toBe(0);
  });

  it('rejects non-sequence directives', () => {
    expect(parseSequence('flowchart TD\n').ok).toBe(false);
    expect(parseSequence('classDiagram\n').ok).toBe(false);
    expect(parseSequence('').ok).toBe(false);
  });

  it('skips blank lines and %% comments', () => {
    const r = parseSequence('\n%% header\n\nsequenceDiagram\n%% body\n\n');
    expect(r.ok).toBe(true);
  });
});

describe('sequence parser — participants', () => {
  it('parses bare participants', () => {
    const r = parseSequence('sequenceDiagram\nparticipant A\nparticipant Bob_2\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.participants.get('A')?.display).toBe('');
    expect(r.graph.participants.get('Bob_2')?.display).toBe('');
  });

  it('parses participants with "as" alias', () => {
    const r = parseSequence('sequenceDiagram\nparticipant A as Alice\nparticipant B as Bob B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.participants.get('A')?.display).toBe('Alice');
    expect(r.graph.participants.get('B')?.display).toBe('Bob B');
  });

  it('rejects "actor" keyword (deferred feature)', () => {
    expect(parseSequence('sequenceDiagram\nactor A\n').ok).toBe(false);
  });
});

describe('sequence parser — messages', () => {
  it('parses each of the four message styles', () => {
    const r = parseSequence(
      'sequenceDiagram\nparticipant A\nparticipant B\nA->B\nA->>B\nA-->B\nA-->>B\n',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const styles = r.graph.events.map((e) => e.kind === 'message' ? e.style : null);
    expect(styles).toEqual(['solid', 'arrow', 'dotted', 'reply']);
  });

  it('parses messages with text after a colon', () => {
    const r = parseSequence('sequenceDiagram\nparticipant A\nparticipant B\nA->>B: Hello world\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.graph.events[0];
    expect(ev.kind).toBe('message');
    if (ev.kind === 'message') expect(ev.text).toBe('Hello world');
  });

  it('parses messages with whitespace around the arrow', () => {
    // Mermaid is permissive about whitespace
    const r = parseSequence('sequenceDiagram\nparticipant A\nparticipant B\nA ->> B : Hi\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.graph.events[0];
    expect(ev.kind).toBe('message');
    if (ev.kind === 'message') {
      expect(ev.from).toBe('A');
      expect(ev.to).toBe('B');
      expect(ev.text).toBe('Hi');
    }
  });

  it('rejects activation suffixes (deferred)', () => {
    expect(parseSequence('sequenceDiagram\nA->>+B: hi\n').ok).toBe(false);
    expect(parseSequence('sequenceDiagram\nA->>-B: bye\n').ok).toBe(false);
  });

  it('rejects unsupported arrow variants', () => {
    expect(parseSequence('sequenceDiagram\nA-xB: hi\n').ok).toBe(false);
    expect(parseSequence('sequenceDiagram\nA--xB: hi\n').ok).toBe(false);
    expect(parseSequence('sequenceDiagram\nA-)B: hi\n').ok).toBe(false);
    expect(parseSequence('sequenceDiagram\nA--)B: hi\n').ok).toBe(false);
  });

  it('auto-creates implicit participants used in a message before declaration', () => {
    // mermaid is happy to parse `A->>B: hi` without explicit `participant`
    // declarations. Match that behavior — auto-create participants in
    // the order they first appear, with empty display.
    const r = parseSequence('sequenceDiagram\nA->>B: hi\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.participants.has('A')).toBe(true);
    expect(r.graph.participants.has('B')).toBe(true);
    expect(r.graph.participants.get('A')?.display).toBe('');
  });
});

describe('sequence parser — notes', () => {
  it('parses each note position', () => {
    const r = parseSequence(
      'sequenceDiagram\nparticipant A\nparticipant B\n' +
      'Note left of A: L\n' +
      'Note right of A: R\n' +
      'Note over A: single\n' +
      'Note over A,B: spanning\n',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const positions = r.graph.events.map((e) =>
      e.kind === 'note' ? { p: e.position, ids: e.participants, t: e.text } : null,
    );
    expect(positions).toEqual([
      { p: 'leftOf', ids: ['A'], t: 'L' },
      { p: 'rightOf', ids: ['A'], t: 'R' },
      { p: 'over', ids: ['A'], t: 'single' },
      { p: 'over', ids: ['A', 'B'], t: 'spanning' },
    ]);
  });

  it('parses notes with whitespace around the comma', () => {
    const r = parseSequence(
      'sequenceDiagram\nparticipant A\nparticipant B\nNote over A , B : both\n',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.graph.events[0];
    expect(ev.kind === 'note' && ev.participants).toEqual(['A', 'B']);
  });

  it('parses an empty-text note (colon present, no text)', () => {
    const r = parseSequence('sequenceDiagram\nparticipant A\nNote right of A:\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.graph.events[0];
    expect(ev.kind === 'note' && ev.text).toBe('');
  });
});

describe('sequence parser — unsupported features bail', () => {
  it('rejects loop / end / alt / opt / par / critical / break / rect / box', () => {
    const cases = [
      'sequenceDiagram\nloop forever\nA->>B: x\nend\n',
      'sequenceDiagram\nalt success\nA->>B: ok\nelse fail\nA->>B: ng\nend\n',
      'sequenceDiagram\nopt maybe\nA->>B: x\nend\n',
      'sequenceDiagram\npar work\nA->>B: x\nand\nA->>C: y\nend\n',
      'sequenceDiagram\ncritical x\nA->>B: x\nend\n',
      'sequenceDiagram\nbreak something\nA->>B: x\nend\n',
      'sequenceDiagram\nrect rgb(0,0,0)\nA->>B: x\nend\n',
      'sequenceDiagram\nbox blue\nparticipant A\nend\n',
    ];
    for (const src of cases) {
      expect(parseSequence(src).ok).toBe(false);
    }
  });

  it('rejects activate/deactivate', () => {
    expect(parseSequence('sequenceDiagram\nA->>B: x\nactivate B\n').ok).toBe(false);
    expect(parseSequence('sequenceDiagram\ndeactivate A\n').ok).toBe(false);
  });

  it('rejects autonumber', () => {
    expect(parseSequence('sequenceDiagram\nautonumber\nA->>B: x\n').ok).toBe(false);
  });
});

describe('sequence parser — round-trip', () => {
  it('round-trips a representative diagram', () => {
    const src =
      'sequenceDiagram\nparticipant A as Alice\nparticipant B as Bob\n' +
      'A->>B: Hello\n' +
      'B-->>A: Hi back\n' +
      'Note right of A: A note\n' +
      'Note over A,B: spanning\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips bare participants and short messages', () => {
    const src = 'sequenceDiagram\nparticipant A\nparticipant B\nA->B\n';
    expect(rt(src)).toBe(src);
  });
});
