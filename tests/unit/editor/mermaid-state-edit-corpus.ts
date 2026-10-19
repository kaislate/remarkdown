// Body of the state corpus property test (run in two halves by
// mermaid-state-edit-corpus-{1,2}.test.ts). Mirroring
// mermaid-flowchart-edit.test.ts: every visual edit × every item it
// applies to must (a) parse back to exactly the intended model, (b)
// leave every line it doesn't semantically touch byte-identical, and
// (c) be accepted by mermaid — plus (d) our reading of the result must
// match mermaid's own db and (e) mermaid must actually draw it (an
// empty group, say, parses but can't be drawn).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mermaid from 'mermaid';
import { applyStateEdit, type StateEdit, type StateEditResult } from '../../../src/lib/editor/mermaid/state-edit';
import { parseStateSource, type StateEndpoint, type StateModel, type StateScope, type StateSourceMap } from '../../../src/lib/editor/mermaid/state-parser';
import { mermaidAccepts, mentions, removedLines } from './mermaid-test-utils';
import { mermaidStateView, stateCorpus, stateView, type StateView } from './mermaid-state-test-utils';

(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

const TRICKY = 'Renamed "q" [x] #59; `b` ; | end: *x*';
const TRICKY_SHOWN = TRICKY;
const TEXT_ONLY = /^(label|transition label|transition unlabel|note text|note lines|note position) /;

type View = Omit<StateView, 'transitionIds' | 'noteIds'>;
type Expect = (v: View, r: StateEditResult) => View;

interface Op {
  name: string;
  edit: StateEdit;
  expected: Expect;
  // Original line indices the edit may remove / rewrite.
  touches: (line: string, k: number) => boolean;
  // Compare states / transitions as sets (edits that reorder them).
  unordered?: boolean;
  // A move reorders statements by design: check that no untouched line
  // went missing (multiset), not that the order of all others held.
  moves?: boolean;
  // The engine must refuse this edit (documented limitation).
  refused?: boolean;
}

// Original lines missing from the output, ignoring order.
function lostLines(before: string, after: string): string[] {
  const count = new Map<string, number>();
  for (const l of after.split(/\r?\n/)) count.set(l, (count.get(l) ?? 0) + 1);
  const out: string[] = [];
  for (const l of before.split(/\r?\n/)) {
    const c = count.get(l) ?? 0;
    if (c > 0) count.set(l, c - 1);
    else out.push(l);
  }
  return out;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const sameScope = (a: StateScope, b: StateScope) => a.parent === b.parent && a.region === b.region;
const usesState = (e: StateEndpoint, ids: string[]) => e.kind === 'state' && ids.includes(e.id);
const inScopes = (e: StateEndpoint, parents: string[]) => e.kind !== 'state' && e.scope.parent !== null && parents.includes(e.scope.parent);

function strip(v: StateView): View {
  const { transitionIds: _t, noteIds: _n, ...rest } = v;
  void _t;
  void _n;
  return rest;
}

// Terminals are those some transition still uses; groups that lost
// every member become plain states (the engine's documented fix-up).
function settle(v: View, before: View): View {
  const out = clone(v);
  const terms: View['terminals'] = [];
  for (const t of out.transitions) {
    for (const e of [t.from, t.to]) {
      if (e.kind !== 'state' && !terms.some((x) => x.kind === e.kind && sameScope(x.scope, e.scope))) terms.push({ kind: e.kind, scope: e.scope });
    }
  }
  out.terminals = before.terminals.filter((t) => terms.some((x) => x.kind === t.kind && sameScope(x.scope, t.scope)));
  for (const t of terms) if (!out.terminals.some((x) => x.kind === t.kind && sameScope(x.scope, t.scope))) out.terminals.push(t);
  const hadMembers = (vv: View, id: string) => vv.states.some((s) => s.parent === id) || vv.terminals.some((t) => t.scope.parent === id);
  for (const s of out.states) {
    if (s.composite && !hadMembers(out, s.id) && hadMembers(before, s.id)) s.composite = null;
  }
  return out;
}

function sorted(v: View): View {
  const out = clone(v);
  const key = (x: unknown) => JSON.stringify(x);
  out.states.sort((a, b) => a.id.localeCompare(b.id));
  out.transitions.sort((a, b) => key(a).localeCompare(key(b)));
  out.notes.sort((a, b) => key(a).localeCompare(key(b)));
  out.terminals.sort((a, b) => key(a).localeCompare(key(b)));
  return out;
}

// Line indices covered by statements matching `pick`.
function stmtLines(src: string, map: StateSourceMap, pick: (i: number) => boolean): Set<number> {
  const out = new Set<number>();
  const lineOf = (off: number) => src.slice(0, off).split('\n').length - 1;
  map.statements.forEach((s, i) => {
    if (!pick(i)) return;
    for (let k = lineOf(s.start); k <= lineOf(Math.max(s.start, s.end - 1)); k++) out.add(k);
  });
  return out;
}

function descendants(m: StateModel, id: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    for (const s of m.states.values()) if (s.parent === p) { out.push(s.id); walk(s.id); }
  };
  walk(id);
  return out;
}

function opsFor(src: string, m: StateModel, map: StateSourceMap): Op[] {
  const ops: Op[] = [];
  const ids = [...m.states.keys()];
  const groups = ids.filter((id) => m.states.get(id)!.composite);
  const blockLines = (id: string) => stmtLines(src, map, (i) => (map.states.get(id)?.blocks ?? []).includes(i));
  // Lines of every statement referring to one of `xs` (bodies included).
  const refLines = (xs: string[]) => stmtLines(src, map, (i) => xs.some((x) => map.states.get(x)?.refs.includes(i)));
  const mentionsAny = (line: string, xs: string[]) => xs.some((x) => mentions(line, x));
  const lastRegion = (g: string | null) => (g === null ? 0 : m.states.get(g)!.composite!.regions - 1);

  for (const id of ids) {
    const s = m.states.get(id)!;
    if (s.composite || s.kind === 'normal') {
      ops.push({
        name: `label ${id}`,
        edit: { kind: 'setStateLabel', id, label: TRICKY },
        expected: (v) => ({ ...v, states: v.states.map((x) => (x.id === id ? { ...x, label: TRICKY_SHOWN } : x)) }),
        touches: (l) => mentions(l, id),
      });
    }
    // Delete (a group with its contents).
    const gone = [id, ...(s.composite ? descendants(m, id) : [])];
    const goneBlocks = refLines(gone);
    ops.push({
      name: `delete ${id}`,
      edit: { kind: 'deleteState', id },
      expected: (v) =>
        settle(
          {
            ...v,
            states: v.states.filter((x) => !gone.includes(x.id)),
            transitions: v.transitions.filter((t) => !usesState(t.from, gone) && !usesState(t.to, gone) && !inScopes(t.from, gone) && !inScopes(t.to, gone)),
            notes: v.notes.filter((n) => !gone.includes(n.state)),
          },
          v,
        ),
      touches: (l, k) => mentionsAny(l, gone) || goneBlocks.has(k) || (s.parent !== null && blockLines(s.parent).has(k)),
    });
    if (!s.composite) {
      const to = s.kind === 'normal' ? 'fork' : 'normal';
      ops.push({
        name: `kind ${id} → ${to}`,
        edit: { kind: 'setStateKind', id, stateKind: to },
        expected: (v) => ({ ...v, states: v.states.map((x) => (x.id === id ? { ...x, kind: to } : x)) }),
        touches: (l) => mentions(l, id),
        // mermaid draws a state with text as a box, whatever its kind.
        refused: to !== 'normal' && (s.label !== id || s.descriptions.length > 0),
        // The declaration goes before the first mention: node order moves.
        unordered: true,
      });
    }
    ops.push({
      name: `note on ${id}`,
      edit: { kind: 'addNote', state: id, position: 'left', text: 'Added: note' },
      expected: (v, r) => {
        const notes = [...v.notes];
        notes.splice(r.index!, 0, { state: id, position: 'left', text: 'Added: note' });
        return { ...v, notes };
      },
      touches: () => false,
    });
    ops.push({
      name: `start/end for ${id}`,
      edit: { kind: 'addEnd', id },
      expected: (v, r) => {
        const transitions = [...v.transitions];
        transitions.splice(r.index!, 0, { from: { kind: 'state', id }, to: { kind: 'end', scope: { parent: s.parent, region: s.region } }, label: '' });
        return settle({ ...v, transitions }, v);
      },
      touches: () => false,
    });
    // Moves: into every other group it can go into, and out to the top.
    const targets: Array<string | null> = groups.filter((g) => g !== id && g !== s.parent && !descendants(m, id).includes(g));
    if (s.parent !== null) targets.push(null);
    for (const into of targets) {
      const oldParentLines = s.parent !== null ? blockLines(s.parent) : new Set<number>();
      const own = refLines([id, ...descendants(m, id)]);
      ops.push({
        moves: true,
        name: `move ${id} → ${into ?? 'top'}`,
        edit: { kind: 'moveState', id, into },
        expected: (v) => {
          // Start / end connections of other groups that held it back
          // may be removed; nothing else changes.
          const states = v.states.map((x) => (x.id === id ? { ...x, parent: into, region: lastRegion(into) } : x));
          return settle({ ...v, states }, v);
        },
        touches: (l, k) => mentions(l, id) || own.has(k) || oldParentLines.has(k),
        unordered: true,
      });
    }
    ops.push({
      name: `wrap ${id}`,
      edit: { kind: 'wrapInComposite', id, label: 'Wrapped group' },
      expected: (v, r) => ({
        ...v,
        states: [
          ...v.states.map((x) => (x.id === id ? { ...x, parent: r.id!, region: 0 } : x)),
          { id: r.id!, label: 'Wrapped group', descriptions: [], kind: 'normal', parent: s.parent, region: s.region, composite: { direction: 'TB', regions: 1 } },
        ],
      }),
      touches: () => false,
      unordered: true,
    });
    if (s.composite) {
      const inner = ids.filter((x) => m.states.get(x)!.parent === id);
      const lines = blockLines(id);
      ops.push({
        name: `ungroup ${id}`,
        edit: { kind: 'ungroup', id },
        expected: (v) =>
          settle(
            {
              ...v,
              states: v.states.filter((x) => x.id !== id).map((x) => (inner.includes(x.id) ? { ...x, parent: s.parent, region: s.region } : x)),
              transitions: v.transitions.filter((t) => !usesState(t.from, [id]) && !usesState(t.to, [id]) && !inScopes(t.from, [id]) && !inScopes(t.to, [id])),
              notes: v.notes.filter((n) => n.state !== id),
            },
            v,
          ),
        touches: (l, k) => mentions(l, id) || (lines.has(k) && /^\s*\}|\[\*\]|^\s*--\s*$|direction/i.test(l)),
      });
      if (s.composite.regions === 1) {
        const dir = s.composite.direction === 'LR' ? 'BT' : 'LR';
        ops.push({
          name: `direction of ${id}`,
          edit: { kind: 'setCompositeDirection', id, direction: dir },
          expected: (v) => ({ ...v, states: v.states.map((x) => (x.id === id ? { ...x, composite: { ...x.composite!, direction: dir } } : x)) }),
          touches: (l, k) => lines.has(k) && /direction/i.test(l),
        });
      }
    }
  }

  m.transitions.forEach((t, index) => {
    const own = stmtLines(src, map, (i) => i === map.transitions[index]);
    ops.push({
      name: `transition label ${index}`,
      edit: { kind: 'setTransitionLabel', index, label: TRICKY },
      expected: (v) => ({ ...v, transitions: v.transitions.map((x, k) => (k === index ? { ...x, label: TRICKY_SHOWN } : x)) }),
      touches: (_l, k) => own.has(k),
    });
    ops.push({
      name: `transition unlabel ${index}`,
      edit: { kind: 'setTransitionLabel', index, label: '' },
      expected: (v) => ({ ...v, transitions: v.transitions.map((x, k) => (k === index ? { ...x, label: '' } : x)) }),
      touches: (_l, k) => own.has(k),
    });
    const ends = [t.from, t.to].flatMap((e) => (e.kind === 'state' ? [e.id] : []));
    ops.push({
      name: `transition delete ${index}`,
      edit: { kind: 'deleteTransition', index },
      expected: (v) => settle({ ...v, transitions: v.transitions.filter((_, k) => k !== index) }, v),
      touches: (l, k) => own.has(k) || ends.some((e) => m.states.get(e)?.parent && blockLines(m.states.get(e)!.parent!).has(k)),
    });
  });

  m.notes.forEach((n, index) => {
    const own = stmtLines(src, map, (i) => i === map.notes[index]);
    ops.push({
      name: `note text ${index}`,
      edit: { kind: 'setNoteText', index, text: TRICKY },
      expected: (v) => ({ ...v, notes: v.notes.map((x, k) => (k === index ? { ...x, text: TRICKY_SHOWN } : x)) }),
      touches: (_l, k) => own.has(k),
    });
    ops.push({
      name: `note lines ${index}`,
      edit: { kind: 'setNoteText', index, text: 'two\nlines' },
      expected: (v) => ({ ...v, notes: v.notes.map((x, k) => (k === index ? { ...x, text: 'two\nlines' } : x)) }),
      touches: (_l, k) => own.has(k),
    });
    const pos = n.position === 'left' ? 'right' : 'left';
    ops.push({
      name: `note position ${index}`,
      edit: { kind: 'setNotePosition', index, position: pos },
      expected: (v) => ({ ...v, notes: v.notes.map((x, k) => (k === index ? { ...x, position: pos } : x)) }),
      touches: (_l, k) => own.has(k),
    });
    ops.push({
      name: `note delete ${index}`,
      edit: { kind: 'deleteNote', index },
      expected: (v) => ({ ...v, notes: v.notes.filter((_, k) => k !== index) }),
      touches: (_l, k) => own.has(k),
    });
  });

  m.terminals.forEach((t) => {
    const usedBy = new Set(
      m.transitions.flatMap((tr, k) => {
        const e = t.kind === 'start' ? tr.from : tr.to;
        return e.kind === t.kind && sameScope(e.scope, t.scope) ? [map.transitions[k]] : [];
      }),
    );
    const own = stmtLines(src, map, (i) => usedBy.has(i));
    ops.push({
      name: `delete ${t.kind} of ${t.scope.parent ?? 'top'}#${t.scope.region}`,
      edit: { kind: 'deleteTerminal', terminal: t },
      expected: (v) =>
        settle({ ...v, transitions: v.transitions.filter((tr) => { const e = t.kind === 'start' ? tr.from : tr.to; return !(e.kind === t.kind && sameScope(e.scope, t.scope)); }) }, v),
      touches: (_l, k) => own.has(k) || (t.scope.parent !== null && blockLines(t.scope.parent).has(k)),
    });
  });

  const last = ids.filter((x) => m.states.get(x)!.parent === null).pop();
  ops.push({
    name: 'add state',
    edit: { kind: 'addState', label: 'Extra step', ...(last ? { connectFrom: { kind: 'state' as const, id: last } } : {}) },
    expected: (v, r) => {
      const transitions = [...v.transitions];
      if (last) transitions.push({ from: { kind: 'state', id: last }, to: { kind: 'state', id: r.id! }, label: '' });
      return { ...v, transitions, states: [...v.states, { id: r.id!, label: 'Extra step', descriptions: [], kind: 'normal', parent: null, region: 0, composite: null }] };
    },
    touches: () => false,
    unordered: true,
  });
  for (const g of groups) {
    ops.push({
      name: `add state in ${g}`,
      edit: { kind: 'addState', label: 'Inner', parent: g, stateKind: 'choice' },
      expected: (v, r) => ({ ...v, states: [...v.states, { id: r.id!, label: r.id!, descriptions: [], kind: 'choice', parent: g, region: lastRegion(g), composite: null }] }),
      touches: () => false,
      unordered: true,
    });
  }
  if (ids.length >= 2) {
    const from = ids[ids.length - 1];
    const to = ids[0];
    ops.push({
      name: 'add transition',
      edit: { kind: 'addTransition', from: { kind: 'state', id: from }, to: { kind: 'state', id: to }, label: 'again' },
      expected: (v, r) => {
        const transitions = [...v.transitions];
        transitions.splice(r.index!, 0, { from: { kind: 'state', id: from }, to: { kind: 'state', id: to }, label: 'again' });
        return { ...v, transitions };
      },
      touches: () => false,
    });
  }
  const other = m.direction === 'LR' ? 'RL' : 'LR';
  ops.push({
    name: `direction ${other}`,
    edit: { kind: 'setDirection', direction: other },
    expected: (v) => ({ ...v, direction: other }),
    touches: (l, k) => /direction/i.test(l) && !stmtLines(src, map, (i) => map.statements[i].container !== null).has(k),
  });
  return ops;
}

// The suite, for corpus half `part` (0 or 1): split over two test files
// so vitest runs them in parallel.
export function corpusProperty(part: 0 | 1): void {
describe(`state edits: corpus property (part ${part + 1} of 2)`, () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false }));
  const all = stateCorpus();
  const blocks = all.filter((_, k) => k % 2 === part);
  it('finds the state corpus', () => {
    expect(all.length).toBeGreaterThanOrEqual(15);
  });

  let n = 0;
  let opCount = 0;
  let drawCount = 0;
  afterAll(() => {
    console.log(`state corpus property, part ${part + 1}: ${opCount} edits checked over ${blocks.length} diagrams, ${drawCount} drawn`);
  });
  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal, valid and drawable`, async () => {
      const parsed = parseStateSource(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      const before = strip(stateView(parsed.model));
      const drawnPerFamily = new Map<string, number>();
      const srcLines = block.source.split('\n');
      for (const op of opsFor(block.source, parsed.model, parsed.map)) {
        const res = applyStateEdit(block.source, op.edit);
        if (op.refused) {
          expect(res, op.name).toBeNull();
          continue;
        }
        expect(res, op.name).not.toBeNull();
        const out = res!.source;
        const back = parseStateSource(out);
        expect(back.ok, `${op.name}: own output unparseable:\n${out}`).toBe(true);
        if (!back.ok) continue;
        const got = strip(stateView(back.model));
        let want = op.expected(clone(before), res!);
        if (op.name.startsWith('move ')) {
          // A start / end connection that would hold the state back may
          // be dropped: expect exactly the transitions that remain, and
          // that only such connections went.
          const missing = before.transitions.filter((t) => !got.transitions.some((g) => JSON.stringify(g) === JSON.stringify(t)));
          const id = (op.edit as { id: string }).id;
          for (const t of missing) expect(t.from.kind !== 'state' || t.to.kind !== 'state', `${op.name}: lost ${JSON.stringify(t)}`).toBe(true);
          for (const t of missing) expect(usesState(t.from, [id]) || usesState(t.to, [id]), op.name).toBe(true);
          want = settle({ ...want, transitions: got.transitions.length < want.transitions.length ? want.transitions.filter((t) => !missing.some((x) => JSON.stringify(x) === JSON.stringify(t))) : want.transitions }, before);
        }
        // (a) exactly the intended change. Start / end circles are
        // compared as a set here; their order (mermaid's node order) is
        // checked against mermaid itself in (d).
        const terms = (v: View): View => ({ ...v, terminals: sorted(v).terminals });
        expect(op.unordered ? sorted(got) : terms(got), `${op.name}:\n${out}`).toEqual(op.unordered ? sorted(want) : terms(want));

        // (b) untouched lines are byte-identical
        const allowed = new Set(srcLines.map((l, k) => (op.touches(l, k) ? l : null)).filter((l): l is string => l !== null));
        for (const line of op.moves ? lostLines(block.source, out) : removedLines(block.source, out)) {
          expect(allowed.has(line), `${op.name} changed an unrelated line ${JSON.stringify(line)}:\n${out}`).toBe(true);
        }

        // (c) mermaid accepts it, (d) reads it the way we do, (e) draws it
        expect(await mermaidAccepts(out), `${op.name}:\n${out}`).toBe(true);
        expect(stateView(back.model), `${op.name}: mermaid reads it differently:\n${out}`).toEqual(await mermaidStateView(out));
        // The two things mermaid parses but can't draw (an empty group, a
        // note before its state's first mention) are flagged by the
        // parser — checked for every edit. Drawing for real is slow: do
        // it for the first edit of each kind per diagram (text-only
        // edits are drawn by the fuzz test).
        expect(back.map.undrawable, `${op.name}:\n${out}`).toEqual([]);
        const family = op.name.split(' ')[0];
        const drawnSoFar = drawnPerFamily.get(family) ?? 0;
        if (!TEXT_ONLY.test(op.name) && drawnSoFar < 1) {
          drawnPerFamily.set(family, drawnSoFar + 1);
          const drawn = await mermaid.render(`sp${n++}`, out).then(() => 'ok', (e) => String(e));
          expect(drawn, `${op.name}: not drawable:\n${out}`).toBe('ok');
          drawCount++;
        }
        opCount++;
      }
    }, 120_000);
  }
});
}
