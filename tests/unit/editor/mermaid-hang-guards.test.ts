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
import { matchMethod, parseClassSource, parseGenericTypes } from '../../../src/lib/editor/mermaid/class-parser';
import { parseErSource } from '../../../src/lib/editor/mermaid/er-parser';
import { parseStateSource } from '../../../src/lib/editor/mermaid/state-parser';
import { styleSemicolons, swapTagQuotes } from '../../../src/lib/editor/mermaid/entity-text';
import { commentRanges } from '../../../src/lib/editor/mermaid/state-parser';
import { tildeWordAhead } from '../../../src/lib/editor/mermaid/er-lexer';
import { aheadOnLine } from '../../../src/lib/editor/mermaid/line-ahead';
import { parseJourney } from '../../../src/lib/editor/mermaid/journey-data';
import { parseQuadrant } from '../../../src/lib/editor/mermaid/quadrant-data';
import { parseRadar } from '../../../src/lib/editor/mermaid/radar-data';
import { parseXyChart } from '../../../src/lib/editor/mermaid/xychart-data';
import { parsePacket } from '../../../src/lib/editor/mermaid/packet-data';
import { parseSankey } from '../../../src/lib/editor/mermaid/sankey-data';
import { findPreamble } from '../../../src/lib/editor/mermaid/source-text';
import { serializeRich } from '../../../src/lib/editor/mermaid/rich-text';

// Generous, so a slow CI machine doesn't fail a fixed parser, and far
// below what the old code took.
const BUDGET_MS = 500;

// Short random strings over `alphabet`, the same ones on every run.
function randomRows(alphabet: string[], count = 20_000, maxLen = 10): string[] {
  let seed = 5;
  const rand = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    let s = '';
    const len = rand(maxLen + 1);
    for (let k = 0; k < len; k++) s += alphabet[rand(alphabet.length)];
    rows.push(s);
  }
  return rows;
}

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

  // Each task's dates split the whole dateFormat into tokens again, so
  // a long format times many tasks was quadratic in the source.
  it('splits a long dateFormat once, not once per task', () => {
    const source = ['gantt', `dateFormat ${'H'.repeat(20_000)}`, ...Array.from({ length: 2_000 }, (_, i) => `T${i} : 1, 1d`)].join('\n');
    const { ms, value } = timed(() => parseGantt(source));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.ok).toBe(true);
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

  // A diagram that ends inside a generic, a class or namespace body, an
  // accDescr block or a callback: there the state's rule matches the
  // empty rest, and that empty token came back again and again until a
  // guard stopped it a million tokens later (most of a second, each
  // time the diagram was read). Same answer, now at once.
  it('stops at the end of a diagram that ends inside a block', () => {
    const sources = [
      () => parseClassSource('classDiagram\nA ~x'),
      () => parseClassSource('classDiagram\nnamespace N {\nclass A'),
      () => parseClassSource('classDiagram\nclass A {\nx'),
      () => parseClassSource('classDiagram\naccDescr {\nx'),
      () => parseClassSource('classDiagram\ncallback A "x'),
      () => parseErSource('erDiagram\naccDescr {\nx'),
    ];
    const { ms, value } = timed(() => sources.map((parse) => parse()));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.map((r) => r.ok)).toEqual(sources.map(() => false));
  });

  // Found by the sweep:
  // - the `<tag a="x">` quote swap (/<(\w+)([^>]*)>/g, as mermaid's
  //   cleanupText) split a `<word` with no `>` after it every way;
  // - the `%%` comment pass (/^\s*%%…/gm) scanned the rest of a run of
  //   blank lines from each line in it;
  // - the ER attribute-word rule (`[^\s]*~.*~…`) scanned the rest of a
  //   run of punctuation for each character in it.
  for (const [name, parse] of [
    ['class <word', () => parseClassSource(`classDiagram\n<<${'a'.repeat(40_000)}`)],
    ['ER <word', () => parseErSource(`erDiagram\nA\n<${'a'.repeat(40_000)}`)],
    ['state <word', () => parseStateSource(`stateDiagram-v2\nA\n<${'a'.repeat(40_000)}`)],
    ['state blank lines', () => parseStateSource(`stateDiagram-v2\nA${'\n'.repeat(40_000)}`)],
    ['ER entity block', () => parseErSource(`erDiagram\nA {\n${'#59;'.repeat(10_000)}`)],
    ['ER braces', () => parseErSource(`erDiagram\n${'{{'.repeat(20_000)}`)],
  ] as const) {
    it(`reads a crafted ${name} in linear time`, () => {
      const { ms } = timed(parse);
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }

  it('swaps tag quotes, finds comment lines and attribute words as the regexes did', () => {
    const LS = String.fromCharCode(0x2028);
    let hits = 0;
    for (const s of randomRows(['<', '>', 'a', 'b', '"', '=', ' ', '\n', LS, '%%', '{', '~', '-', '\t'], 20_000, 12)) {
      const tags = s.replace(/<(\w+)([^>]*)>/g, (_m, tag: string, attrs: string) => `<${tag}${attrs.replace(/="([^"]*)"/g, "='$1'")}>`);
      expect(swapTagQuotes(s), JSON.stringify(s)).toBe(tags);
      const comments = [...s.matchAll(/^\s*%%(?!{)[^\n]+\n?/gm)].map((m) => [m.index!, m.index! + m[0].length]);
      expect(commentRanges(s), JSON.stringify(s)).toEqual(comments);
      const ahead = tildeWordAhead(s);
      for (let pos = 0; pos <= s.length; pos++) {
        const word = /^(?:([^\s]*)[~].*[~]([^\s]*))/i.test(s.slice(pos));
        expect(ahead(pos), `${JSON.stringify(s)} at ${pos}`).toBe(word);
        if (word) hits++;
      }
      if (comments.length || tags !== s) hits++;
    }
    expect(hits).toBeGreaterThan(500);
  });

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

describe('class members', () => {
  // Found by the sweep: mermaid's method pattern, /([#+~-])?(.+)\((.*)\)…/,
  // is unanchored, and on a member with no `(` before a `)` it runs
  // `.+` to the end and back from every start, and `(.*)` to the end
  // and back from every `(`: cubic. 1.5 KB took seconds. mermaid can't
  // read such a member either, so the diagram stays text-edited.
  it('turns down a method with a long run of parentheses in linear time', () => {
    const { ms, value } = timed(() => parseClassSource(`classDiagram\nclass A {\n  a)${'('.repeat(1_500)}\n}\n`));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.ok).toBe(false);
  });

  // `name: type`'s `\s*(.*)$` retried every split of a run of spaces
  // when a line separator stopped the `.` (and then the field threw).
  it('reads a `name: type` field with a long run of spaces in linear time', () => {
    const LS = String.fromCharCode(0x2028);
    const { ms, value } = timed(() => parseClassSource(`classDiagram\nclass A {\n  a:${' '.repeat(40_000)}x${LS}y\n}\n`));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.ok && value.model.classes.get('A')?.members[0]).toMatchObject({ kind: 'field', name: 'a', type: `x${LS}y` });
  });

  // mermaid's parseGenericTypes turned `~`s into `<…>` pairs by looking
  // for the first and the last `~` from scratch each time: quadratic.
  it('reads a long run of generic markers in linear time', () => {
    const { ms } = timed(() => parseGenericTypes('~'.repeat(80_000)));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('reads methods the way mermaid’s pattern does', () => {
    const LS = String.fromCharCode(0x2028);
    let hits = 0;
    for (const s of randomRows(['a', ' ', '(', ')', '((', '))', '#', '+', '~', '-', '$', '*', '\n', '\r', LS], 20_000, 12)) {
      const old = /([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?/.exec(s);
      expect(matchMethod(s), JSON.stringify(s)).toEqual(old && [old[0], old[1], old[2], old[3], old[4], old[5]]);
      if (old) hits++;
    }
    expect(hits).toBeGreaterThan(2_000);
  });

  it('pairs generic markers the way mermaid does', () => {
    // mermaid's own processSet, step by step.
    const processSet = (input: string): string => {
      const tildes = input.split('~').length - 1;
      let startingTilde = false;
      if (tildes <= 1) return input;
      if (tildes % 2 !== 0 && input.startsWith('~')) {
        input = input.substring(1);
        startingTilde = true;
      }
      const chars = [...input];
      let first = chars.indexOf('~');
      let last = chars.lastIndexOf('~');
      while (first !== -1 && last !== -1 && first !== last) {
        chars[first] = '<';
        chars[last] = '>';
        first = chars.indexOf('~');
        last = chars.lastIndexOf('~');
      }
      if (startingTilde) chars.unshift('~');
      return chars.join('');
    };
    for (const s of randomRows(['~', 'a', ' ', '~~'], 5_000, 10)) {
      expect(parseGenericTypes(s), JSON.stringify(s)).toBe(processSet(s));
    }
    expect(parseGenericTypes('List~int~')).toBe('List<int>');
    expect(parseGenericTypes('Map~K, V~')).toBe('Map<K, V>');
  });
});

describe('data diagrams', () => {
  const spaces = ' '.repeat(40_000);

  // A lazy name (`[^:]+?`) before `\s*:`, a lazy axis label before
  // `\s*-->`, and two `\s*` side by side each rescanned a long run of
  // spaces from every position in it.
  for (const [name, parse, ok] of [
    ['journey task', () => parseJourney(`journey\nsection s\nx${spaces}y`), false],
    ['journey task name', () => parseJourney(`journey\nsection s\nx${spaces}y: 3: Me`), true],
    ['quadrant axis', () => parseQuadrant(`quadrantChart\nx-axis a${spaces}b`), true],
    ['quadrant point', () => parseQuadrant(`quadrantChart\nx${spaces}y`), false],
    ['radar curve', () => parseRadar(`radar-beta\ncurve a${spaces}x`), false],
  ] as const) {
    it(`reads a ${name} with a long run of spaces in linear time`, () => {
      const { ms, value } = timed(parse);
      expect(ms).toBeLessThan(BUDGET_MS);
      expect(value !== null).toBe(ok);
    });
  }

  // A lone CR or a U+2028 stops `.`, so `title\s+(.*)$` and the like
  // failed at it and retried every split of the spaces before it. A
  // line holding one isn't a line mermaid reads the same way anyway.
  const LS = String.fromCharCode(0x2028);
  for (const [name, parse] of [
    ['journey', (t: string) => parseJourney(`journey\n${t}`)],
    ['quadrant', (t: string) => parseQuadrant(`quadrantChart\n${t}`)],
    ['radar', (t: string) => parseRadar(`radar-beta\n${t}`)],
    ['xychart', (t: string) => parseXyChart(`xychart-beta\n${t}`)],
    ['packet', (t: string) => parsePacket(`packet-beta\n${t}`)],
    ['sankey', (t: string) => parseSankey(`sankey-beta\n${t}`)],
  ] as const) {
    it(`leaves a ${name} line with a line break inside to the text panel, quickly`, () => {
      for (const brk of ['\r', LS]) {
        const { ms, value } = timed(() => parse(`title${spaces}a${brk}b`));
        expect(ms).toBeLessThan(BUDGET_MS);
        expect(value).toBeNull();
      }
    });
  }

  // Random rows over the characters that matter, read by the parser and
  // by the regex it used to use: the same fields every time.
  it('reads every row the way the old patterns did', () => {
    const rows = randomRows(['a', 'b', ' ', '  ', ':', '-->', '[', ']', ',', '1', '.', '-', '"', '{', '}', 'x-axis ', 'curve ']);
    let hits = 0;
    for (const row of rows) {
      const t = row.trim();
      if (!t || /^(title|section|quadrant-|axis|max|min|showLegend|ticks|graticule)/.test(t)) continue;
      const task = /^([^:]+?)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?::\s*(.*))?$/.exec(t);
      const j = parseJourney(`journey\nsection s\n${t}`);
      expect(j?.sections[0].tasks[0] ?? null, t).toEqual(
        task ? { line: 2, name: task[1].trim(), score: Number(task[2]), people: (task[3] ?? '').split(',').map((p) => p.trim()).filter(Boolean) } : null,
      );
      const axis = /^([xy])-axis\s+(.*?)(?:\s*-->\s*(.*))?$/.exec(t);
      const point = /^([^:[\]]+?)\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]$/.exec(t);
      const q = parseQuadrant(`quadrantChart\n${t}`);
      if (axis) expect(q?.xAxis ?? q?.yAxis, t).toEqual({ line: 1, low: axis[2].trim(), high: (axis[3] ?? '').trim() });
      else if (point) expect(q?.points[0], t).toEqual({ line: 1, name: point[1].trim(), x: Number(point[2]), y: Number(point[3]) });
      else expect(q, t).toBeNull();
      const curve = /^curve\s+([A-Za-z_][\w-]*)\s*(?:\[\s*"([^"]*)"\s*\])?\s*\{(.*)\}$/.exec(t);
      const r = parseRadar(`radar-beta\n${t}`);
      if (curve) expect([r?.curves[0]?.id, r?.curves[0]?.label], t).toEqual(r ? [curve[1], curve[2] ?? ''] : [undefined, undefined]);
      else expect(r, t).toBeNull();
      if (task || axis || point || curve) hits++;
    }
    expect(hits).toBeGreaterThan(100);
  });

  it('still reads names, axes and curves as before', () => {
    const j = parseJourney('journey\nsection s\n  Make tea  :  5 : Me, You');
    expect(j?.sections[0].tasks[0]).toMatchObject({ name: 'Make tea', score: 5, people: ['Me', 'You'] });
    const q = parseQuadrant('quadrantChart\nx-axis  Low  stuff   -->  High\ny-axis Only low\nA  b : [0.1, 0.2]');
    expect(q?.xAxis).toMatchObject({ low: 'Low  stuff', high: 'High' });
    expect(q?.yAxis).toMatchObject({ low: 'Only low', high: '' });
    expect(q?.points[0]).toMatchObject({ name: 'A  b', x: 0.1, y: 0.2 });
    const r = parseRadar('radar-beta\naxis a, b\ncurve c  ["C"]  {1, 2}\ncurve d {3, 4}');
    expect(r?.curves.map((c) => [c.id, c.label, c.values])).toEqual([['c', 'C', [1, 2]], ['d', '', [3, 4]]]);
  });
});

describe('frontmatter and labels', () => {
  const spaces = ' '.repeat(40_000);

  // `(.*?)\s*$` grew the lazy value one character at a time, and each
  // time `\s*$` scanned the rest of a run of spaces.
  it('reads a frontmatter title with a long run of spaces in linear time', () => {
    const lines = ['---', `title: a${spaces}b  `, '---', 'pie'];
    const { ms, value } = timed(() => findPreamble(lines));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.frontmatter?.title?.value).toBe(`a${spaces}b`);
    expect(value.frontmatter?.title?.span).toEqual({ start: 7, end: 7 + spaces.length + 2 });
  });

  it('reads titles and writes labels the way the old patterns did', () => {
    const LS = String.fromCharCode(0x2028);
    for (const row of randomRows(['a', ' ', '  ', '\t', '\r', LS, '"', ':', 'title'])) {
      const old = /^(\s*title\s*:\s*)(.*?)\s*$/.exec(row);
      const title = findPreamble(['---', row, '---', 'pie']).frontmatter?.title ?? null;
      expect(title && { span: title.span }, JSON.stringify(row)).toEqual(old && { span: { start: old[1].length, end: old[1].length + old[2].length } });
      const line = /^(\s*)(.*?)(\s*)$/.exec(row);
      if (!line) continue;
      const expected = line[2] ? `${line[1]}**${line[2]}**${line[3]}` : row;
      expect(serializeRich([{ text: row, bold: true, italic: false }]), JSON.stringify(row)).toBe(expected);
    }
  });

  it('writes a formatted label with a long run of spaces in linear time', () => {
    const { ms, value } = timed(() => serializeRich([{ text: `  a${spaces}b `, bold: true, italic: false }]));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).toBe(`  **a${spaces}b** `);
  });
});
