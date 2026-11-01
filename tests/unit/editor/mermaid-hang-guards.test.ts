// Diagram text comes from whatever file the user opens, and the edit
// mode parsers run on the UI thread. None of them may take more than
// linear time on crafted input: each case here is a diagram that once
// froze the app for seconds (or for good), scaled so the old code took
// well over 2 s. A fixed parser reads them in a few milliseconds.
import { describe, it, expect } from 'vitest';
import { parseGantt } from '../../../src/lib/editor/mermaid/gantt-parser';
import { parseGanttDate } from '../../../src/lib/editor/mermaid/gantt-dates';
import { parseMermaidSource, type SubgraphStatement } from '../../../src/lib/editor/mermaid-parser';
import { applyFlowchartEdit } from '../../../src/lib/editor/mermaid-flowchart-edit';
import { parseSequenceSource } from '../../../src/lib/editor/mermaid-sequence-parser';
import { parseClassSource } from '../../../src/lib/editor/mermaid/class-parser';
import { parseErSource } from '../../../src/lib/editor/mermaid/er-parser';
import { parseStateSource } from '../../../src/lib/editor/mermaid/state-parser';
import { styleSemicolons } from '../../../src/lib/editor/mermaid/entity-text';
import { aheadOnLine } from '../../../src/lib/editor/mermaid/line-ahead';

// Generous, so a slow CI machine doesn't fail a fixed parser, and far
// below what the old code took.
const BUDGET_MS = 500;

function timed<T>(fn: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

describe('gantt dates', () => {
  // G73: `HHHH…` is a run of one-or-two-digit tokens, and a regex over
  // the whole format tried all 2^n ways to split the digits.
  it('reads a long run of digit tokens without trying every split', () => {
    const k = 60;
    const source = ['gantt', `dateFormat ${'H'.repeat(k)}`, `T : a1, 2026-01-01, ${'1'.repeat(k)}x`].join('\n');
    const { ms, value } = timed(() => parseGantt(source));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.ok).toBe(true);
  });

  it('reads tokens split by empty literals (H[]H[]…) the same way', () => {
    const k = 28;
    const { ms, value } = timed(() => parseGanttDate(`${'1'.repeat(2 * k)}x`, Array(k).fill('H').join('[]')));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).toBeNull();
  });
});

describe('flowchart', () => {
  // G70: an id-less subgraph's placeholder id was `#pending<n>`, which a
  // bare subgraph id can also be. Closing it moved the user's subgraph
  // into its own group, and finding a node's outermost group looped
  // forever.
  it("keeps a user's `#pendingN` subgraph apart from an id-less one", () => {
    const source = ['flowchart TD', 'subgraph #pending1', 'subgraph "t"', 'X', 'end', 'end', 'subgraph #pending1', 'end'].join('\n');
    const parsed = parseMermaidSource(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const subgraphs = parsed.map.statements.filter((s): s is SubgraphStatement => s.kind === 'subgraph');
    expect(subgraphs.map((s) => [s.id, s.group])).toEqual([
      ['#pending1', null],
      ['subGraph0', '#pending1'],
      ['#pending1', null],
    ]);
    expect(parsed.graph.groupOf.get('X')).toBe('subGraph0');
    const { ms, value } = timed(() => applyFlowchartEdit(source, { kind: 'setNodeGroup', id: 'X', group: null }));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).not.toBeNull();
  });

  it('reads a `#pendingN` subgraph that is not repeated', () => {
    const source = ['flowchart TD', 'subgraph #pending1', 'subgraph "t"', 'X', 'end', 'end'].join('\n');
    expect(parseMermaidSource(source).ok).toBe(true);
  });

  // G72: each newline inside an open `{` scanned the whole bracket stack.
  it('splits statements in linear time under a deep bracket stack', () => {
    const k = 60_000;
    const source = `flowchart TD\nA${'['.repeat(k)}{${'\n'.repeat(k)}`;
    const { ms } = timed(() => parseMermaidSource(source));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  // G72: closing an id-less subgraph rescanned every statement so far.
  it('closes many id-less subgraphs in linear time', () => {
    const source = `flowchart TD\n${'subgraph "t"\nX\nend\n'.repeat(8_000)}`;
    const { ms, value } = timed(() => parseMermaidSource(source));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.ok).toBe(true);
  });
});

describe('sequence', () => {
  const spaces = ' '.repeat(70_000);

  // G71: the alias's lazy `.+?` grew one character at a time, and each
  // time `\s*$` scanned the rest of the run of spaces.
  it('reads a participant alias with a long run of spaces in linear time', () => {
    const { ms, value } = timed(() => parseSequenceSource(`sequenceDiagram\nparticipant A as x${spaces}y`));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.ok).toBe(true);
    if (value.ok) expect(value.graph.participants.get('A')?.display.length).toBeGreaterThan(70_000);
  });

  // G71: the two `\s*` around a message's activation mark could split a
  // run of spaces every way.
  it('rejects a message with a long run of spaces in linear time', () => {
    const { ms, value } = timed(() => parseSequenceSource(`sequenceDiagram\nA->${spaces}!`));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.ok).toBe(false);
  });

  // A U+2028 stops `.`, so `\s*:\s*(.*)$` retried every split of the
  // spaces before it.
  it('rejects a line holding a line separator in linear time', () => {
    for (const line of [`Note over A:${spaces}x\u2028y`, `A->>B:${spaces}x\u2028y`, `participant A as${spaces}x\u2028y`]) {
      const { ms, value } = timed(() => parseSequenceSource(`sequenceDiagram\n${line}`));
      expect(ms).toBeLessThan(BUDGET_MS);
      expect(value.ok).toBe(false);
    }
  });

  it('still reads aliases, activations and texts as before', () => {
    const r = parseSequenceSource(
      ['sequenceDiagram', 'participant A as  Alice  ', 'participant B as   ', 'A->> +B: hi', 'B-->>- A:  back ', 'A->>+ B'].join('\n'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.participants.get('A')?.display).toBe('Alice');
    expect(r.map.declarations.get('B')?.[0].hasDisplay).toBe(true);
    expect(r.graph.events.map((e) => (e.kind === 'message' ? [e.from, e.to, e.text, e.activation ?? null] : null))).toEqual([
      ['A', 'B', 'hi', 'activate'],
      ['B', 'A', 'back', 'deactivate'],
      ['A', 'B', '', 'activate'],
    ]);
  });
});

describe('style lines in class, ER and state diagrams', () => {
  // G74: mermaid's `style.*:\S*#.*;` pass, copied as a regex, tried
  // every `style` × `:` × `#` on a line with no `;` (about L^4).
  const line = 'style:#'.repeat(400);
  for (const [name, parse] of [
    ['class', () => parseClassSource(`classDiagram\nclass A\n${line}`)],
    ['ER', () => parseErSource(`erDiagram\nA ||--o{ B : has\n${line}`)],
    ['state', () => parseStateSource(`stateDiagram-v2\nA --> B\n${line}`)],
  ] as const) {
    it(`reads a long style line in a ${name} diagram in linear time`, () => {
      const { ms } = timed(parse);
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }

  // The linear scan must find exactly the `;` the regex would, so every
  // diagram lexes as it did. Short random lines over the characters
  // that matter cover the cases.
  it('drops the same `;` as the regex it replaces', () => {
    const alphabet = ['style', 'classDef', ':', '#', ';', ' ', 'x', '\u2028', '\r', '\n'];
    let hits = 0;
    let seed = 7;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    for (let i = 0; i < 20_000; i++) {
      let s = '';
      const len = 1 + rand(12);
      for (let k = 0; k < len; k++) s += alphabet[rand(alphabet.length)];
      for (const keyword of ['style', 'classDef'] as const) {
        const re = new RegExp(`${keyword}.*:\\S*#.*;`, 'g');
        const expected = [...s.matchAll(re)].map((m) => m.index! + m[0].length - 1);
        expect(styleSemicolons(s, keyword), JSON.stringify(s)).toEqual(expected);
        hits += expected.length;
      }
    }
    // Enough lines that do lose a `;` to mean something.
    expect(hits).toBeGreaterThan(50);
  });
});

describe('class, ER and state lexers', () => {
  // G75: the `.*direction\s+TB` rules (and BT/RL/LR) ran to the end of
  // the line and back for every token, so one long line was quadratic.
  for (const [name, parse] of [
    ['class', () => parseClassSource(`classDiagram\n${'A <|-- B '.repeat(5_000)}`)],
    ['ER', () => parseErSource(`erDiagram\n${'A ||--o{ B : x '.repeat(3_000)}`)],
    ['state', () => parseStateSource(`stateDiagram-v2\n${'A --> B '.repeat(5_000)}`)],
    ['state block', () => parseStateSource(`stateDiagram-v2\nstate X {\n${'A --> B '.repeat(5_000)}\n}`)],
  ] as const) {
    it(`lexes a long line of a ${name} diagram in linear time`, () => {
      const { ms } = timed(parse);
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }

  it('still reads a direction anywhere on its line', () => {
    const cls = parseClassSource('classDiagram\nclass A\nA <|-- B direction LR');
    expect(cls.ok && cls.model.direction).toBe('LR');
    const er = parseErSource('erDiagram\nA ||--o{ B : x DIRECTION   rl');
    expect(er.ok && er.model.direction).toBe('RL');
    const st = parseStateSource('stateDiagram-v2\nA --> B direction BT');
    expect(st.ok && st.model.direction).toBe('BT');
  });

  // The lexers skip a `.*X` rule where aheadOnLine says no, so it must
  // say yes exactly where the rule's regex matches.
  it('says a rule can match exactly where its regex does', () => {
    const alphabet = ['direction', 'DIRECTION', ' ', '\n', '\r', '\u2028', 'LR', 'TB', 'x', '<<fork>>', '[[fork]]'];
    let seed = 11;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    let hits = 0;
    for (let i = 0; i < 3_000; i++) {
      let text = '';
      const len = 1 + rand(10);
      for (let k = 0; k < len; k++) text += alphabet[rand(alphabet.length)];
      for (const pattern of ['direction\\s+LR', 'direction\\s+TB', '<<fork>>', '\\[\\[fork\\]\\]']) {
        for (const flags of ['', 'i']) {
          const ahead = aheadOnLine(text, pattern, flags);
          const re = new RegExp(`.*${pattern}`, `y${flags}`);
          for (let pos = 0; pos <= text.length; pos++) {
            re.lastIndex = pos;
            const expected = re.test(text);
            expect(ahead(pos), `${JSON.stringify(text)} at ${pos}`).toBe(expected);
            if (expected) hits++;
          }
        }
      }
    }
    expect(hits).toBeGreaterThan(200);
  });
});
