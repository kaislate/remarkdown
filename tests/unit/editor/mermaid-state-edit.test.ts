// Source-preserving visual edits on state diagrams. The invariant:
// after a visual edit, every source line the edit did not semantically
// touch is byte-identical (comments, %%{init}%%, frontmatter, blank
// lines, ordering, indentation, `stateDiagram` vs `stateDiagram-v2`),
// the result parses to exactly the intended model, and mermaid accepts
// (and draws) it.
import { describe, it, expect, beforeAll } from 'vitest';
import mermaid from 'mermaid';
import { applyStateEdit, encodeStateText, stateTextMarkdown, type StateEdit } from '../../../src/lib/editor/mermaid/state-edit';
import { parseState, type StateModel } from '../../../src/lib/editor/mermaid/state-parser';
import { FUZZ_INPUTS, mermaidAccepts } from './mermaid-test-utils';

(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

function edit(src: string, e: StateEdit): string {
  const r = applyStateEdit(src, e);
  if (!r) throw new Error(`edit refused: ${JSON.stringify(e)}`);
  return r.source;
}

function model(src: string): StateModel {
  const r = parseState(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

const lines = (...l: string[]) => l.join('\n');

describe('state edits: labels', () => {
  it('rewrites the quoted name of `state "…" as Id`', () => {
    const src = lines('stateDiagram-v2', '    state "Waiting" as W', '    W --> Done', '');
    expect(edit(src, { kind: 'setStateLabel', id: 'W', label: 'Waiting for payment' })).toBe(
      lines('stateDiagram-v2', '    state "Waiting for payment" as W', '    W --> Done', ''),
    );
  });

  it('rewrites the text of `Id : …` when that is the title', () => {
    const src = lines('stateDiagram-v2', '    A : old title', '    A : more', '    A --> B', '');
    expect(edit(src, { kind: 'setStateLabel', id: 'A', label: 'New title' })).toBe(
      lines('stateDiagram-v2', '    A : New title', '    A : more', '    A --> B', ''),
    );
  });

  it('adds `state "…" as Id` after the first mention when the title is the id', () => {
    const src = lines('stateDiagram-v2', '    [*] --> Idle', '    %% keep me', '    Idle --> Busy', '');
    expect(edit(src, { kind: 'setStateLabel', id: 'Idle', label: 'Doing nothing' })).toBe(
      lines('stateDiagram-v2', '    [*] --> Idle', '    state "Doing nothing" as Idle', '    %% keep me', '    Idle --> Busy', ''),
    );
  });

  it('a group label goes into its opener', () => {
    const src = lines('stateDiagram-v2', '    state Running {', '        [*] --> Loading', '    }', '');
    expect(edit(src, { kind: 'setStateLabel', id: 'Running', label: 'Running now' })).toBe(
      lines('stateDiagram-v2', '    state "Running now" as Running {', '        [*] --> Loading', '    }', ''),
    );
  });

  it('a blank label shows a blank title (not the id)', () => {
    const out = edit('stateDiagram-v2\n  state "x" as A\n', { kind: 'setStateLabel', id: 'A', label: '' });
    expect(out).toBe('stateDiagram-v2\n  state "#32;" as A\n');
    expect(model(out).states.get('A')!.label).toBe('');
  });

  it('keeps frontmatter, init directives, CRLF and the legacy header', () => {
    const src = '---\r\ntitle: T\r\n---\r\n%%{init: {"theme": "forest"}}%%\r\nstateDiagram\r\n    A --> B : go\r\n';
    expect(edit(src, { kind: 'setTransitionLabel', index: 0, label: 'went' })).toBe(src.replace('go', 'went'));
  });

  it('refuses a label on fork / join / choice (they show none)', () => {
    expect(applyStateEdit('stateDiagram-v2\n  state f <<fork>>\n', { kind: 'setStateLabel', id: 'f', label: 'x' })).toBeNull();
  });
});

describe('state edits: adding states', () => {
  const src = lines('stateDiagram-v2', '    [*] --> Idle', '    Idle --> Busy', '    %% trailing', '');

  it('a plain-word label becomes the id itself', () => {
    const r = applyStateEdit(src, { kind: 'addState', label: 'Done', connectFrom: { kind: 'state', id: 'Busy' } })!;
    expect(r.id).toBe('Done');
    expect(r.source).toBe(lines('stateDiagram-v2', '    [*] --> Idle', '    Idle --> Busy', '    Busy --> Done', '    %% trailing', ''));
  });

  it('other labels get a declaration and a readable id', () => {
    const r = applyStateEdit(src, { kind: 'addState', label: 'Waiting for payment' })!;
    expect(r.id).toBe('WaitingForPayment');
    expect(r.source).toBe(lines('stateDiagram-v2', '    [*] --> Idle', '    Idle --> Busy', '    state "Waiting for payment" as WaitingForPayment', '    %% trailing', ''));
  });

  it('never reuses an id or a keyword', () => {
    expect(applyStateEdit(src, { kind: 'addState', label: 'Idle' })!.id).toBe('Idle1');
    expect(applyStateEdit(src, { kind: 'addState', label: 'note' })!.id).toBe('NoteState');
  });

  it('adds fork / join / choice states', () => {
    const r = applyStateEdit(src, { kind: 'addState', label: '', stateKind: 'choice', connectFrom: { kind: 'state', id: 'Busy' } })!;
    expect(r.id).toBe('choice1');
    expect(r.source).toContain('    state choice1 <<choice>>\n    Busy --> choice1\n');
    expect(model(r.source).states.get('choice1')!.kind).toBe('choice');
  });

  it('adds inside a group; a transition from outside goes to the top level', () => {
    const g = lines('stateDiagram-v2', '    [*] --> G', '    state G {', '        a --> b', '    }', '');
    const r = applyStateEdit(g, { kind: 'addState', label: 'c', parent: 'G', connectFrom: { kind: 'state', id: 'b' } })!;
    expect(r.source).toBe(lines('stateDiagram-v2', '    [*] --> G', '    state G {', '        a --> b', '        b --> c', '    }', ''));
    const r2 = applyStateEdit(g, { kind: 'addState', label: 'c', parent: 'G', connectFrom: { kind: 'state', id: 'G' } })!;
    expect(r2.source).toBe(lines('stateDiagram-v2', '    [*] --> G', '    state G {', '        a --> b', '        c', '    }', '    G --> c', ''));
    expect(model(r2.source).states.get('c')!.parent).toBe('G');
  });
});

describe('state edits: deleting', () => {
  it('removes a state with its transitions, notes, descriptions and style references', () => {
    const src = lines(
      'stateDiagram-v2',
      '    classDef hot fill:#f00',
      '    [*] --> A',
      '    A --> B : go',
      '    A : about A',
      '    B --> C',
      '    note right of A : n',
      '    class A, C hot',
      '    %% end',
      '',
    );
    expect(edit(src, { kind: 'deleteState', id: 'A' })).toBe(
      lines('stateDiagram-v2', '    classDef hot fill:#f00', '    B', '    B --> C', '    class C hot', '    %% end', ''),
    );
  });

  it('a group goes with its body and everything referring to what was inside', () => {
    const src = lines('stateDiagram-v2', '    [*] --> Idle', '    Idle --> Running', '    state Running {', '        [*] --> Loading', '    }', '    Loading --> Idle', '    Idle --> [*]', '');
    expect(edit(src, { kind: 'deleteState', id: 'Running' })).toBe(lines('stateDiagram-v2', '    [*] --> Idle', '    Idle --> [*]', ''));
  });

  it('a group left empty becomes a plain state with its label', () => {
    const src = lines('stateDiagram-v2', '    state "The group" as G {', '        a', '    }', '    G --> x', '');
    expect(edit(src, { kind: 'deleteState', id: 'a' })).toBe(lines('stateDiagram-v2', '    state "The group" as G', '    G --> x', ''));
  });

  it('deleting a transition keeps a state it introduced', () => {
    expect(edit('stateDiagram-v2\n  A --> B\n  B --> C\n', { kind: 'deleteTransition', index: 0 })).toBe('stateDiagram-v2\n  A\n  B\n  B --> C\n');
    expect(edit('stateDiagram-v2\n  A\n  B\n  A --> B\n', { kind: 'deleteTransition', index: 0 })).toBe('stateDiagram-v2\n  A\n  B\n');
  });

  it('deleting the last lines leaves no stray line break (with or without a final newline)', () => {
    expect(edit('stateDiagram-v2\n  A --> B\n  B --> X\n  X --> [*]', { kind: 'deleteState', id: 'X' })).toBe('stateDiagram-v2\n  A --> B');
    expect(edit('stateDiagram-v2\n  A --> B\n  B --> X\n  X --> [*]\n', { kind: 'deleteState', id: 'X' })).toBe('stateDiagram-v2\n  A --> B\n');
    expect(edit('stateDiagram-v2\r\n  A --> B\r\n  B --> X\r\n  X --> [*]', { kind: 'deleteState', id: 'X' })).toBe('stateDiagram-v2\r\n  A --> B');
  });

  it('deleting a start circle removes its transitions', () => {
    const src = 'stateDiagram-v2\n  [*] --> A\n  A --> B\n  [*] --> B\n';
    expect(edit(src, { kind: 'deleteTerminal', terminal: { kind: 'start', scope: { parent: null, region: 0 } } })).toBe('stateDiagram-v2\n  A\n  A --> B\n');
  });
});

describe('state edits: groups', () => {
  it('ungroup keeps the contents one level up, minus the group\'s own start/end', () => {
    const src = lines('stateDiagram-v2', '    [*] --> Idle', '    Idle --> Running', '    state Running {', '        direction LR', '        [*] --> Loading', '        Loading --> Working', '    }', '    Working --> Idle', '');
    const out = edit(src, { kind: 'ungroup', id: 'Running' });
    expect(out).toBe(lines('stateDiagram-v2', '    [*] --> Idle', '        Loading', '        Loading --> Working', '    Working --> Idle', ''));
    expect(model(out).states.get('Loading')!.parent).toBeNull();
  });

  it('wraps a state in a new group', () => {
    const src = lines('stateDiagram-v2', '    [*] --> A', '    A --> B', '');
    const r = applyStateEdit(src, { kind: 'wrapInComposite', id: 'B', label: 'Phase two' })!;
    expect(r.id).toBe('PhaseTwo');
    expect(r.source).toBe(lines('stateDiagram-v2', '    [*] --> A', '    A --> B', '    state "Phase two" as PhaseTwo {', '        B', '    }', ''));
    expect(model(r.source).states.get('B')!.parent).toBe('PhaseTwo');
  });

  it('moves a state into a group and back out', () => {
    const src = lines('stateDiagram-v2', '    [*] --> A', '    state G {', '        g1 --> g2', '    }', '    A --> G', '');
    const inG = edit(src, { kind: 'moveState', id: 'A', into: 'G' });
    expect(inG).toBe(lines('stateDiagram-v2', '    [*] --> A', '    state G {', '        g1 --> g2', '        A', '    }', '    A --> G', ''));
    expect(model(inG).states.get('A')!.parent).toBe('G');
    const out = edit(inG, { kind: 'moveState', id: 'A', into: null });
    expect(model(out).states.get('A')!.parent).toBeNull();
    expect(out).toBe(lines('stateDiagram-v2', '    [*] --> A', '    state G {', '        g1 --> g2', '    }', '    A --> G', '    A', ''));
  });

  it('moving out of a group: inner transitions go to the top level, the group\'s start connection goes', () => {
    const src = lines('stateDiagram-v2', '    state G {', '        [*] --> a', '        a --> b', '    }', '');
    const out = edit(src, { kind: 'moveState', id: 'a', into: null });
    expect(out).toBe(lines('stateDiagram-v2', '    state G {', '        b', '    }', '    a --> b', ''));
    const m = model(out);
    expect(m.states.get('a')!.parent).toBeNull();
    expect(m.states.get('b')!.parent).toBe('G');
  });

  it('sets a group\'s direction', () => {
    const src = lines('stateDiagram-v2', '    state G {', '        a --> b', '    }', '');
    expect(edit(src, { kind: 'setCompositeDirection', id: 'G', direction: 'LR' })).toBe(lines('stateDiagram-v2', '    state G {', '        direction LR', '        a --> b', '    }', ''));
  });
});

describe('state edits: kinds', () => {
  it('normal → fork declares it before the first mention', () => {
    const src = 'stateDiagram-v2\n  A --> F\n  F --> B\n';
    expect(edit(src, { kind: 'setStateKind', id: 'F', stateKind: 'fork' })).toBe('stateDiagram-v2\n  state F <<fork>>\n  A --> F\n  F --> B\n');
  });

  it('fork → join / normal rewrites the declaration', () => {
    const src = 'stateDiagram-v2\n  state F <<fork>>\n  A --> F\n';
    expect(edit(src, { kind: 'setStateKind', id: 'F', stateKind: 'join' })).toBe('stateDiagram-v2\n  state F <<join>>\n  A --> F\n');
    expect(edit(src, { kind: 'setStateKind', id: 'F', stateKind: 'normal' })).toBe('stateDiagram-v2\n  F\n  A --> F\n');
  });
});

describe('state edits: transitions', () => {
  it('adds, relabels and unlabels', () => {
    const src = 'stateDiagram-v2\n  A --> B\n';
    const r = applyStateEdit(src, { kind: 'addTransition', from: { kind: 'state', id: 'B' }, to: { kind: 'state', id: 'A' }, label: 'back' })!;
    expect(r.source).toBe('stateDiagram-v2\n  A --> B\n  B --> A : back\n');
    expect(r.index).toBe(1);
    expect(edit(src, { kind: 'setTransitionLabel', index: 0, label: 'go' })).toBe('stateDiagram-v2\n  A --> B : go\n');
    expect(edit('stateDiagram-v2\n  A-->B:go\n', { kind: 'setTransitionLabel', index: 0, label: 'went' })).toBe('stateDiagram-v2\n  A-->B:went\n');
    expect(edit('stateDiagram-v2\n  A --> B : go\n', { kind: 'setTransitionLabel', index: 0, label: '' })).toBe('stateDiagram-v2\n  A --> B\n');
  });

  it('a transition inside one group goes into it; across groups, to the top level', () => {
    const src = lines('stateDiagram-v2', '    state G {', '        a', '        b', '    }', '    c', '');
    expect(edit(src, { kind: 'addTransition', from: { kind: 'state', id: 'a' }, to: { kind: 'state', id: 'b' } })).toBe(
      lines('stateDiagram-v2', '    state G {', '        a', '        b', '        a --> b', '    }', '    c', ''),
    );
    expect(edit(src, { kind: 'addTransition', from: { kind: 'state', id: 'a' }, to: { kind: 'state', id: 'c' } })).toBe(
      lines('stateDiagram-v2', '    state G {', '        a', '        b', '    }', '    c', '    a --> c', ''),
    );
  });

  it('start / end connections belong to the state\'s scope', () => {
    const src = lines('stateDiagram-v2', '    state G {', '        a', '    }', '');
    expect(edit(src, { kind: 'addStart', id: 'a' })).toBe(lines('stateDiagram-v2', '    state G {', '        a', '        [*] --> a', '    }', ''));
    expect(edit(src, { kind: 'addEnd', id: 'G' })).toBe(lines('stateDiagram-v2', '    state G {', '        a', '    }', '    G --> [*]', ''));
    // A group's own start can't point outside it.
    expect(applyStateEdit(src, { kind: 'addTransition', from: { kind: 'start', scope: { parent: 'G', region: 0 } }, to: { kind: 'state', id: 'G' } })).toBeNull();
  });
});

describe('state edits: notes', () => {
  const src = lines('stateDiagram-v2', '    A --> B', '    note right of A : first', '');

  it('adds single-line and multi-line notes', () => {
    const r = applyStateEdit(src, { kind: 'addNote', state: 'B', position: 'left', text: 'about B' })!;
    expect(r.source).toBe(lines('stateDiagram-v2', '    A --> B', '    note right of A : first', '    note left of B : about B', ''));
    expect(r.index).toBe(1);
    expect(edit(src, { kind: 'addNote', state: 'B', position: 'left', text: 'one\ntwo' })).toBe(
      lines('stateDiagram-v2', '    A --> B', '    note right of A : first', '    note left of B', '        one', '        two', '    end note', ''),
    );
  });

  it('edits text (switching to the multi-line form when needed) and position', () => {
    expect(edit(src, { kind: 'setNoteText', index: 0, text: 'changed: yes' })).toBe(src.replace(': first', ': changed#58; yes'));
    const multi = edit(src, { kind: 'setNoteText', index: 0, text: 'line 1\nline 2' });
    expect(multi).toBe(lines('stateDiagram-v2', '    A --> B', '    note right of A', '        line 1', '        line 2', '    end note', ''));
    expect(edit(multi, { kind: 'setNoteText', index: 0, text: 'only' })).toBe(lines('stateDiagram-v2', '    A --> B', '    note right of A', '        only', '    end note', ''));
    expect(edit(src, { kind: 'setNotePosition', index: 0, position: 'left' })).toBe(src.replace('right of', 'left of'));
    expect(edit(src, { kind: 'deleteNote', index: 0 })).toBe(lines('stateDiagram-v2', '    A --> B', ''));
    expect(applyStateEdit(src, { kind: 'setNoteText', index: 0, text: '  ' })).toBeNull();
  });
});

describe('state edits: direction and title', () => {
  it('changes or adds the top-level direction', () => {
    expect(edit('stateDiagram-v2\n  direction TB\n  A\n', { kind: 'setDirection', direction: 'LR' })).toBe('stateDiagram-v2\n  direction LR\n  A\n');
    expect(edit('stateDiagram-v2\n  A\n', { kind: 'setDirection', direction: 'LR' })).toBe('stateDiagram-v2\n  direction LR\n  A\n');
    expect(edit('stateDiagram-v2\n  A\n', { kind: 'setDirection', direction: 'TB' })).toBe('stateDiagram-v2\n  A\n');
  });

  it('sets the frontmatter title', () => {
    expect(edit('stateDiagram-v2\n  A\n', { kind: 'setTitle', title: 'Life' })).toBe('---\ntitle: Life\n---\nstateDiagram-v2\n  A\n');
  });

  it('existing ids that are keywords elsewhere still connect (`end`, `hide`)', async () => {
    const src = 'stateDiagram-v2\n  A --> end\n  hide --> A\n';
    const out = edit(src, { kind: 'addTransition', from: { kind: 'state', id: 'end' }, to: { kind: 'state', id: 'hide' } });
    expect(out).toBe('stateDiagram-v2\n  A --> end\n  hide --> A\n  end --> hide\n');
    expect(await mermaidAccepts(out)).toBe(true);
    expect(model(out).transitions).toHaveLength(3);
  });

  it('refuses unknown ids and sources it cannot parse', () => {
    expect(applyStateEdit('stateDiagram-v2\n  A\n', { kind: 'deleteState', id: 'Nope' })).toBeNull();
    expect(applyStateEdit('flowchart TD\n  A\n', { kind: 'deleteState', id: 'A' })).toBeNull();
    expect(applyStateEdit('stateDiagram-v2\n  A\n', { kind: 'setTransitionLabel', index: 3, label: 'x' })).toBeNull();
  });
});

// ── Fuzz: every user text field × FUZZ_INPUTS ─────────────────────────

// Extra inputs for mermaid-specific hazards (markdown, keywords).
const STATE_FUZZ = [
  ...FUZZ_INPUTS,
  '*stars* and _under_',
  '**bold**',
  'back\\slash',
  'trailing colon:',
  'a :: b',
  'set direction LR',
  'state x [[fork]]',
  'style: #x;',
  '50%%{init}',
  'end note',
  '-- --',
];

async function rendered(src: string, id: string): Promise<Document> {
  const { svg } = await mermaid.render(id, src);
  return new DOMParser().parseFromString(svg, 'text/html');
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('state edits: typed text reaches the diagram exactly', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false }));
  let n = 0;
  const base = lines('stateDiagram-v2', '    state "Old" as A', '    A --> B : old', '    note right of A : old', '    state G {', '        g', '    }', '    B --> G', '');

  for (const input of STATE_FUZZ) {
    it(JSON.stringify(input), async () => {
      // What mermaid shows: trimmed, whitespace collapsed (HTML).
      const want = input.replace(/\s+/g, ' ').trim();
      let added = '';
      const fields: Array<{ name: string; edit: StateEdit; read: (m: StateModel) => string; shown: (d: Document) => string }> = [
        { name: 'state label', edit: { kind: 'setStateLabel', id: 'A', label: input }, read: (m) => m.states.get('A')!.label, shown: (d) => text(d.querySelector('g.node[id*="-state-A-"]')) },
        { name: 'new state label', edit: { kind: 'setStateLabel', id: 'B', label: input }, read: (m) => m.states.get('B')!.label, shown: (d) => text(d.querySelector('g.node[id*="-state-B-"]')) },
        { name: 'group label', edit: { kind: 'setStateLabel', id: 'G', label: input }, read: (m) => m.states.get('G')!.label, shown: (d) => text(d.querySelector('[data-id="G"] .cluster-label')) },
        { name: 'transition label', edit: { kind: 'setTransitionLabel', index: 0, label: input }, read: (m) => m.transitions[0].label, shown: (d) => text(d.querySelector('g.label[data-id="edge0"]')) },
        { name: 'note text', edit: { kind: 'setNoteText', index: 0, text: input }, read: (m) => m.notes[0].text, shown: (d) => text(d.querySelector('g.statediagram-note')) },
        { name: 'added state', edit: { kind: 'addState', label: input }, read: (m) => m.states.get(added)!.label, shown: (d) => text(d.querySelector(`g.node[id*="-state-${added}-"]`)) },
      ];
      // Every field is edited in turn on the same diagram, so one drawing
      // shows them all (drawing is the slow part).
      let src = base;
      const checked: typeof fields = [];
      for (const f of fields) {
        const r = applyStateEdit(src, f.edit);
        if (f.name === 'note text' && want === '') {
          // An empty note is refused: the popover deletes it instead.
          expect(r, f.name).toBeNull();
          continue;
        }
        expect(r, f.name).not.toBeNull();
        src = r!.source;
        if (r!.id) added = r!.id;
        expect(await mermaidAccepts(src), `${f.name}:\n${src}`).toBe(true);
        checked.push(f);
      }
      const m = model(src);
      const d = await rendered(src, `fz${n++}`);
      for (const f of checked) {
        expect(f.read(m), `${f.name}: model\n${src}`).toBe(want);
        expect(f.shown(d), `${f.name}: drawn\n${src}`).toBe(want);
      }
      // Nothing else changed.
      expect(m.states.size).toBe(model(base).states.size + 1);
      expect(m.transitions.length).toBe(2);
      expect(m.notes.length).toBe(1);
    });
  }

  it('multi-line note text keeps its lines', async () => {
    const out = edit(base, { kind: 'setNoteText', index: 0, text: 'line one: a;b\n  end note  \n%% not a comment' });
    expect(model(out).notes[0].text).toBe('line one: a;b\nend note\n%% not a comment');
    const d = await rendered(out, `fz${n++}`);
    expect(d.querySelector('g.statediagram-note')!.textContent).toContain('end note');
  });

  it('markdown text keeps bold / italic and writes escaped markers literally', async () => {
    const md = '**Bold** and *it* with a literal \\* star \\_ too';
    const out = edit(base, { kind: 'setStateLabel', id: 'A', label: md, markdown: true });
    expect(out).toContain('state "**Bold** and *it* with a literal #42; star #95; too" as A');
    const d = await rendered(out, `fz${n++}`);
    const node = d.querySelector('g.node[id*="-state-A-"]')!;
    expect(node.querySelector('strong')?.textContent).toBe('Bold');
    expect(node.querySelector('em')?.textContent).toBe('it');
    expect(text(node)).toBe('Bold and it with a literal * star _ too');
    // …and reads back as the same markdown.
    expect(stateTextMarkdown(out, { kind: 'state', id: 'A' })).toBe(md);
    const t = edit(base, { kind: 'setTransitionLabel', index: 0, label: '*go*', markdown: true });
    expect(t).toContain('A --> B : *go*');
    expect(stateTextMarkdown(t, { kind: 'transition', index: 0 })).toBe('*go*');
    const nt = edit(base, { kind: 'setNoteText', index: 0, text: '**one**\ntwo', markdown: true });
    expect(stateTextMarkdown(nt, { kind: 'note', index: 0 })).toBe('**one**\ntwo');
    // Plain text read as markdown: markers that are literal come escaped.
    expect(stateTextMarkdown(base, { kind: 'state', id: 'B' })).toBe('B');
    expect(stateTextMarkdown('stateDiagram-v2\n  A : x #42; y\n', { kind: 'state', id: 'A' })).toBe('x \\* y');
  });

  it('encodes only what it must', () => {
    expect(encodeStateText('Plain words, (and) more!', 'label')).toBe('Plain words, (and) more!');
    expect(encodeStateText('a: b', 'label')).toBe('a: b');
    expect(encodeStateText('a: b', 'note')).toBe('a#58; b');
  });
});
