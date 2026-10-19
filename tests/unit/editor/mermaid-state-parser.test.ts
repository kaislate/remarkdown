// State diagram parser: the model must be exactly what mermaid 11.14
// draws (states, labels, nesting, transitions in edge order, notes),
// checked against mermaid's own parsed db as the oracle.
import { describe, it, expect } from 'vitest';
import {
  parseState,
  parseStateSource,
  STATE_STARTER,
  type StateModel,
  type StateEndpoint,
} from '../../../src/lib/editor/mermaid/state-parser';
import { mermaidAccepts } from './mermaid-test-utils';
import { stateCorpus, stateView, mermaidStateView } from './mermaid-state-test-utils';

function model(src: string): StateModel {
  const r = parseState(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

const S = (id: string): StateEndpoint => ({ kind: 'state', id });
const START = (parent: string | null = null, region = 0): StateEndpoint => ({ kind: 'start', scope: { parent, region } });
const END = (parent: string | null = null, region = 0): StateEndpoint => ({ kind: 'end', scope: { parent, region } });

describe('state parser: targeted examples', () => {
  it('reads transitions, labels and start/end', () => {
    const m = model('stateDiagram-v2\n    [*] --> Idle\n    Idle --> Running : start\n    Running --> [*]\n');
    expect(m.version).toBe(2);
    expect([...m.states.keys()]).toEqual(['Idle', 'Running']);
    expect(m.states.get('Idle')).toMatchObject({ label: 'Idle', descriptions: [], kind: 'normal', parent: null, region: 0, composite: null });
    expect(m.transitions).toEqual([
      { from: START(), to: S('Idle'), label: '' },
      { from: S('Idle'), to: S('Running'), label: 'start' },
      { from: S('Running'), to: END(), label: '' },
    ]);
    expect(m.terminals).toEqual([{ kind: 'start', scope: { parent: null, region: 0 } }, { kind: 'end', scope: { parent: null, region: 0 } }]);
    expect(m.direction).toBe('TB');
  });

  it('accepts the legacy stateDiagram header', () => {
    const m = model('stateDiagram\n  A --> B\n');
    expect(m.version).toBe(1);
    expect(m.transitions).toHaveLength(1);
  });

  it('shows the first description as the title and the rest below it', () => {
    const m = model(
      'stateDiagram-v2\n  state "Waiting for payment" as W\n  W : 15 minutes\n  W : then cancel\n  X : only\n  Y\n',
    );
    expect(m.states.get('W')).toMatchObject({ label: 'Waiting for payment', descriptions: ['15 minutes', 'then cancel'] });
    // A single `Id : text` replaces the id as the displayed title.
    expect(m.states.get('X')).toMatchObject({ label: 'only', descriptions: [] });
    expect(m.states.get('Y')).toMatchObject({ label: 'Y', descriptions: [] });
  });

  it('ignores a bare `state X` (mermaid draws nothing for it)', () => {
    expect([...model('stateDiagram-v2\n  state X\n  A\n').states.keys()]).toEqual(['A']);
  });

  it('decodes entity codes the way mermaid displays them', () => {
    const m = model('stateDiagram-v2\n  state "a #gt; b#59;" as A\n  A --> B : x #amp; y\n');
    expect(m.states.get('A')!.label).toBe('a > b;');
    expect(m.transitions[0].label).toBe('x & y');
  });

  it('nests composites with their own start/end', () => {
    const m = model(
      'stateDiagram-v2\n  [*] --> Outer\n  state Outer {\n    [*] --> Inner\n    state Inner {\n      [*] --> Leaf\n      Leaf --> [*]\n    }\n  }\n',
    );
    expect(m.states.get('Outer')).toMatchObject({ parent: null, composite: { direction: 'TB', regions: 1 } });
    expect(m.states.get('Inner')).toMatchObject({ parent: 'Outer', composite: { direction: 'TB', regions: 1 } });
    expect(m.states.get('Leaf')).toMatchObject({ parent: 'Inner', composite: null });
    expect(m.transitions).toEqual([
      { from: START(), to: S('Outer'), label: '' },
      { from: START('Outer'), to: S('Inner'), label: '' },
      { from: START('Inner'), to: S('Leaf'), label: '' },
      { from: S('Leaf'), to: END('Inner'), label: '' },
    ]);
  });

  it('a composite label comes from `state "…" as Id {`', () => {
    const m = model('stateDiagram-v2\n  state "Checkout flow" as C {\n    direction LR\n    A --> B\n  }\n');
    expect(m.states.get('C')).toMatchObject({ label: 'Checkout flow', composite: { direction: 'LR', regions: 1 } });
    expect(m.direction).toBe('TB');
  });

  it('reads fork / join / choice; the first mention decides the shape (like mermaid)', () => {
    const m = model('stateDiagram-v2\n  state f <<fork>>\n  state j <<join>>\n  state c <<choice>>\n  state x [[fork]]\n  A --> late\n  state late <<fork>>\n');
    expect(m.states.get('f')!.kind).toBe('fork');
    expect(m.states.get('j')!.kind).toBe('join');
    expect(m.states.get('c')!.kind).toBe('choice');
    expect(m.states.get('x')!.kind).toBe('fork');
    expect(m.states.get('late')!.kind).toBe('normal');
  });

  it('reads single-line and multi-line notes', () => {
    const m = model(
      'stateDiagram-v2\n  A --> B\n  note right of A : hello there\n  note left of B\n      first line\n      second line\n  end note\n',
    );
    expect(m.notes).toEqual([
      { state: 'A', position: 'right', text: 'hello there' },
      { state: 'B', position: 'left', text: 'first line\nsecond line' },
    ]);
  });

  it('splits concurrency regions; start/end are scoped per region', () => {
    const m = model(
      'stateDiagram-v2\n  state Active {\n    [*] --> A1\n    A1 --> A2\n    --\n    [*] --> B1\n  }\n',
    );
    expect(m.states.get('Active')!.composite).toEqual({ direction: 'TB', regions: 2 });
    expect(m.states.get('A1')).toMatchObject({ parent: 'Active', region: 0 });
    expect(m.states.get('B1')).toMatchObject({ parent: 'Active', region: 1 });
    expect(m.transitions[2]).toEqual({ from: START('Active', 1), to: S('B1'), label: '' });
    expect(m.render.regions.get('Active')).toEqual(['divider-id-1', null]);
  });

  it('a state belongs to the LAST group it is mentioned in (mermaid rule)', () => {
    const m = model('stateDiagram-v2\n  state G {\n    X --> Y\n  }\n  state H {\n    X\n  }\n  X --> Z\n');
    expect(m.states.get('X')!.parent).toBe('H');
    expect(m.states.get('Y')!.parent).toBe('G');
    expect(m.states.get('Z')!.parent).toBeNull();
  });

  it('reads the top-level direction (last one wins)', () => {
    expect(model('stateDiagram-v2\n  direction LR\n  A\n').direction).toBe('LR');
    expect(model('stateDiagram-v2\n  direction LR\n  direction BT\n  A\n').direction).toBe('BT');
  });

  it('keeps comments, init directives, frontmatter and styling out of the model', () => {
    const src = [
      '---',
      'title: Lights',
      '---',
      '%%{init: {"theme": "forest"}}%%',
      'stateDiagram-v2',
      '    %% comment',
      '    classDef hot fill:#f00,color:white',
      '    [*] --> Red:::hot',
      '    Red --> Green : go',
      '    class Green hot',
      '    hide empty description',
      '    accTitle: Lights',
    ].join('\n');
    const m = model(src);
    expect(m.title).toBe('Lights');
    expect([...m.states.keys()]).toEqual(['Red', 'Green']);
    expect(m.transitions.map((t) => t.label)).toEqual(['', 'go']);
  });

  it('numbers rendered edges like mermaid: notes take a number too', () => {
    const m = model('stateDiagram-v2\n  A --> B\n  note right of A : n\n  B --> C\n');
    expect(m.render.transitions).toEqual(['edge0', 'edge2']);
    expect(m.render.notes).toEqual(['A----note-1']);
  });

  it('keeps CRLF sources parseable', () => {
    expect(model('stateDiagram-v2\r\n  A --> B : x\r\n').transitions[0].label).toBe('x');
  });

  it('refuses non-state diagrams and syntax mermaid rejects', () => {
    expect(parseState('flowchart TD\n  A --> B\n').ok).toBe(false);
    expect(parseState('').ok).toBe(false);
    expect(parseState('stateDiagram-v2\n  A -> B\n').ok).toBe(false);
    expect(parseState('stateDiagram-v2\n  state "x" as G {\n    A\n').ok).toBe(false);
    // mermaid: a group may carry only one label.
    expect(parseState('stateDiagram-v2\n  state G {\n    A\n  }\n  G : one\n  G : two\n').ok).toBe(false);
  });

  it('maps statements to source positions', () => {
    const src = 'stateDiagram-v2\n  A --> B : go\n';
    const r = parseStateSource(src);
    if (!r.ok) throw new Error(r.reason);
    const t = r.map.transitions[0];
    const stmt = r.map.statements[t];
    expect(src.slice(stmt.start, stmt.end)).toBe('A --> B : go');
    expect(stmt.t === 'relation' && src.slice(stmt.label!.start, stmt.label!.end)).toBe('go');
  });

  it('STATE_STARTER is a small valid diagram', async () => {
    const m = model(STATE_STARTER);
    expect(m.states.size).toBeGreaterThanOrEqual(3);
    expect(m.transitions.length).toBeGreaterThanOrEqual(3);
    expect(await mermaidAccepts(STATE_STARTER)).toBe(true);
  });
});

// ── Oracle: mermaid's own db ─────────────────────────────────────────

// Corner cases of mermaid's own rules, on top of the corpus.
const TRICKY: Array<[string, string]> = [
  ['two notes on one state', 'stateDiagram-v2\n  A --> B\n  note right of A : one\n  note left of A : two\n'],
  ['note numbers shift edges', 'stateDiagram-v2\n  A\n  note right of A : early\n  A --> B\n  B --> C : x\n'],
  ['last group wins', 'stateDiagram-v2\n  state G {\n    X --> Y\n  }\n  state H {\n    X\n  }\n  X --> Z\n'],
  ['fork with a description is a box', 'stateDiagram-v2\n  state F <<fork>>\n  F : text\n  A --> F\n  state J <<join>>\n  state "named" as J\n'],
  ['fork used before declared','stateDiagram-v2\n  A --> F\n  state F <<fork>>\n  F --> B\n'],
  ['description on a group', 'stateDiagram-v2\n  state G {\n    a --> b\n  }\n  G : The group\n'],
  ['as Id:extra', 'stateDiagram-v2\n  state "Title" as T:more text\n'],
  ['direction inside a label line', 'stateDiagram-v2\n  A --> B : turn direction LR now\n  C\n'],
  ['comment after a statement', 'stateDiagram-v2\n  A --> B %% trailing\n  B --> C\n'],
  ['hash comment', 'stateDiagram-v2\n  A --> B\n  # a comment\n  B --> C\n'],
  ['semicolon ends a label', 'stateDiagram-v2\n  A --> B : one;C\n'],
  ['deep nesting with regions', 'stateDiagram-v2\n  state P {\n    state Q {\n      [*] --> q1\n      --\n      [*] --> q2\n      q2 --> [*]\n    }\n    --\n    p1 --> p2\n  }\n  [*] --> P\n'],
  ['empty trailing region', 'stateDiagram-v2\n  state P {\n    a --> b\n    --\n  }\n'],
  ['bare star statement', 'stateDiagram-v2\n  [*]\n  A --> [*]\n'],
  ['note with odd colon spacing', 'stateDiagram-v2\n  A\n  note right of A:tight\n  note left of A  :  loose\n'],
  ['uppercase keywords', 'stateDiagram-v2\n  STATE "Big" AS B\n  NOTE LEFT OF B : n\n  Direction RL\n'],
  ['transition into a group', 'stateDiagram-v2\n  [*] --> G\n  state G {\n    [*] --> g1\n  }\n  g1 --> Out\n'],
  ['one-line group', 'stateDiagram-v2\n  state G { a --> b }\n'],
  ['entities in all text kinds', 'stateDiagram-v2\n  state "x #lt;y#gt;" as A\n  A : desc #59; more\n  A --> B : t #35;1\n  note right of B : n #amp; m\n'],
];

describe('state parser: matches mermaid', () => {
  const corpus = stateCorpus();
  it('finds the state corpus', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(15);
  });

  for (const [heading, source] of [...corpus.map((b) => [b.heading, b.source] as [string, string]), ...TRICKY]) {
    it(`${heading}: same states, labels, nesting, transitions and notes as mermaid`, async () => {
      expect(stateView(model(source))).toEqual(await mermaidStateView(source));
    });
  }
});

