// Clicks on a rendered state diagram → the model item they hit, and
// back. The fixtures are SVG that mermaid 11.14 drew in a real browser
// (tests/fixtures/mermaid-svg/state-*.svg, captured from the app) for
// the state corpus blocks of the same name.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseState, type StateModel } from '../../../src/lib/editor/mermaid/state-parser';
import { stateElementFor, stateTargetAt, stateTargets, type StateTarget } from '../../../src/lib/editor/mermaid/state-svg';
import { stateCorpus } from './mermaid-state-test-utils';

function fixture(name: string): SVGSVGElement | null {
  const file = resolve(__dirname, '../../fixtures/mermaid-svg', `${name}.svg`);
  if (!existsSync(file)) return null;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${readFileSync(file, 'utf8')}</body>`, 'text/html');
  return doc.querySelector('svg') as SVGSVGElement;
}

function model(src: string): StateModel {
  const r = parseState(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

const corpus = new Map(stateCorpus().map((b) => [b.heading, b.source]));

function load(name: string): { svg: SVGSVGElement; m: StateModel } {
  const svg = fixture(name);
  if (!svg) throw new Error(`missing fixture ${name}`);
  return { svg, m: model(corpus.get(name)!) };
}

const at = (svg: SVGSVGElement, m: StateModel, sel: string): StateTarget | null => {
  const el = svg.querySelector(sel);
  if (!el) throw new Error(`no element ${sel}`);
  return stateTargetAt(el, svg, m);
};

describe('state SVG: clicks map to model items', () => {
  it('states, groups, transitions (nested ones numbered in source order), start / end, notes', () => {
    const { svg, m } = load('state-diagram');
    // Clicking the text inside a state box.
    expect(at(svg, m, 'g.node[id$="-state-Idle-14"] p')).toEqual({ kind: 'state', id: 'Idle' });
    // A fork bar (no text).
    expect(at(svg, m, 'g.node[id*="-state-fork_state-"] path')).toEqual({ kind: 'state', id: 'fork_state' });
    // The group's label and its background.
    expect(at(svg, m, '[data-id="Running"] .cluster-label p')).toEqual({ kind: 'composite', id: 'Running' });
    expect(at(svg, m, '[data-id="Running"] rect.outer')).toEqual({ kind: 'composite', id: 'Running' });
    // Transitions: the path and the label; edge5 is the first one inside
    // the group (mermaid numbers them depth-first in source order).
    expect(at(svg, m, 'path[data-id="edge1"]')).toEqual({ kind: 'transition', index: 1 });
    expect(at(svg, m, 'g.label[data-id="edge1"] p')).toEqual({ kind: 'transition', index: 1 });
    expect(m.transitions[5]).toMatchObject({ from: { kind: 'start', scope: { parent: 'Running', region: 0 } } });
    expect(at(svg, m, 'path[data-id="edge5"]')).toEqual({ kind: 'transition', index: 5 });
    expect(at(svg, m, 'path[data-id="edge13"]')).toEqual({ kind: 'transition', index: 13 });
    // Start / end circles, per scope.
    expect(at(svg, m, 'g.node[id$="-state-root_start-0"] circle')).toEqual({ kind: 'start', scope: { parent: null, region: 0 } });
    expect(at(svg, m, 'g.node[id*="-state-Running_end-"]')).toEqual({ kind: 'end', scope: { parent: 'Running', region: 0 } });
    // The note, its connector and its background.
    expect(at(svg, m, 'g.statediagram-note p')).toEqual({ kind: 'note', index: 0 });
    expect(at(svg, m, 'path.note-edge')).toEqual({ kind: 'note', index: 0 });
    expect(at(svg, m, 'g.note-cluster')).toEqual({ kind: 'note', index: 0 });
    // Background: nothing.
    expect(stateTargetAt(svg, svg, m)).toBeNull();
  });

  it('notes take an edge number: transitions after a note are matched by mermaid\'s id', () => {
    const { svg, m } = load('state-notes');
    // edge0 is the note on State1; the only transition is edge1.
    expect(m.render.transitions).toEqual(['edge1']);
    expect(at(svg, m, 'path[data-id="edge1"]')).toEqual({ kind: 'transition', index: 0 });
    expect(at(svg, m, 'g.node[id*="-state-State2----note-"]')).toEqual({ kind: 'note', index: 1 });
    // A left-of note's connector runs note → state.
    expect(at(svg, m, 'path[data-id="State2----note-2-State2"]')).toEqual({ kind: 'note', index: 1 });
  });

  it('concurrency regions: start circles and region backgrounds', () => {
    const { svg, m } = load('state-concurrency');
    expect(at(svg, m, 'g.node[id*="-state-divider-id-1_start-"]')).toEqual({ kind: 'start', scope: { parent: 'Active', region: 0 } });
    // The last region's id is random (per render): found by elimination.
    const last = [...svg.querySelectorAll('g.node[id*="_start-"]')].find((e) => /-state-id-[a-z0-9]+-\d+_start-/.test(e.id))!;
    expect(stateTargetAt(last, svg, m)).toEqual({ kind: 'start', scope: { parent: 'Active', region: 1 } });
    // A region's background selects its group.
    const region = svg.querySelector('.statediagram-cluster-alt')!;
    expect(stateTargetAt(region, svg, m)).toEqual({ kind: 'composite', id: 'Active' });
  });

  it('a duplicated transition maps to each copy', () => {
    const { svg, m } = load('state-duplicate-transitions');
    expect(at(svg, m, 'g.label[data-id="edge0"]')).toEqual({ kind: 'transition', index: 0 });
    expect(at(svg, m, 'g.label[data-id="edge1"]')).toEqual({ kind: 'transition', index: 1 });
  });

  it('ignores ids that are not in the model (stale SVG)', () => {
    const { svg } = load('state-diagram');
    const other = model('stateDiagram-v2\n  X --> Y\n');
    expect(at(svg, other, 'g.node[id$="-state-Idle-14"]')).toBeNull();
    expect(at(svg, other, 'path[data-id="edge5"]')).toBeNull();
  });
});

describe('state SVG: every item round-trips', () => {
  for (const name of corpus.keys()) {
    it(name, () => {
      const svg = fixture(name);
      expect(svg, `fixture for ${name}`).not.toBeNull();
      const m = model(corpus.get(name)!);
      const targets = stateTargets(m);
      // states + groups + transitions + notes + start / end circles
      expect(targets.length).toBe(m.states.size + m.transitions.length + m.notes.length + m.terminals.length);
      for (const t of targets) {
        const el = stateElementFor(svg!, m, t);
        expect(el, `${name}: no element for ${JSON.stringify(t)}`).not.toBeNull();
        expect(stateTargetAt(el!, svg!, m), `${name}: ${JSON.stringify(t)}`).toEqual(t);
      }
      // …and everything clickable that mermaid drew maps to something.
      for (const el of svg!.querySelectorAll('g.node, path.transition, g.edgeLabel g.label[data-id], .statediagram-cluster')) {
        expect(stateTargetAt(el, svg!, m), `${name}: unmapped ${el.tagName}#${el.id} ${el.getAttribute('data-id') ?? ''}`).not.toBeNull();
      }
    });
  }
});
