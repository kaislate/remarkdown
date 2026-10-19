// Class diagram click-target mapping, against SVG captured from the
// app in a real browser (tests/fixtures/mermaid-svg/class-*.svg; the
// sources below are exactly what was rendered).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classTargetAt, classElementFor, type ClassTarget } from '../../../src/lib/editor/mermaid/class-svg';
import { parseClass, type ClassModel } from '../../../src/lib/editor/mermaid/class-parser';
import { corpusBlocks } from './mermaid-test-utils';

const RICH = [
  'classDiagram',
  '    note "Global note"',
  '    namespace Shapes {',
  '        class Shape~T~ {',
  '            <<interface>>',
  '            +area() double',
  '        }',
  '        class Circle["Round thing"] {',
  '            +double radius',
  '            -int id$',
  '            +draw(Canvas c) void',
  '        }',
  '    }',
  '    class Canvas',
  '    Canvas : +List~Shape~ items',
  '    Canvas : +render() void',
  '    Shape~T~ <|.. Circle : implements',
  '    Canvas "1" o-- "*" Circle : holds',
  '    Canvas --> Circle',
  '    Canvas --> Canvas : self',
  '    note for Canvas "Draws everything"',
  '    Circle --() Drawable',
  '',
].join('\n');

const PLAIN = ['classDiagram', '    class Order-Item', '    class `Weird Name`', '    Order-Item --> `Weird Name`', '    Order-Item --> `Weird Name`', ''].join('\n');

function load(file: string): SVGSVGElement {
  document.body.innerHTML = readFileSync(resolve(__dirname, '../../fixtures/mermaid-svg', file), 'utf8');
  return document.querySelector('svg') as unknown as SVGSVGElement;
}

function model(src: string): ClassModel {
  const r = parseClass(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

// The element holding visible text `text` (innermost).
function byText(svg: Element, text: string): Element {
  const hit = [...svg.querySelectorAll('p, span, div')].filter((e) => e.textContent === text);
  if (!hit.length) throw new Error(`no element with text ${text}`);
  return hit[hit.length - 1];
}

// Every target the model has must map to an element that maps back.
function roundTrip(svg: SVGSVGElement, m: ClassModel): ClassTarget[] {
  const targets: ClassTarget[] = [];
  for (const [id, c] of m.classes) {
    for (const part of ['box', 'title', 'annotation'] as const) if (part !== 'annotation' || c.annotations.length) targets.push({ kind: 'class', id, part });
    c.members.forEach((_x, index) => targets.push({ kind: 'member', classId: id, index }));
  }
  m.relations.forEach((r, index) => {
    targets.push({ kind: 'relation', index, part: 'line' });
    targets.push({ kind: 'relation', index, part: 'label' });
    if (r.fromCardinality) targets.push({ kind: 'cardinality', index, end: 'from' });
    if (r.toCardinality) targets.push({ kind: 'cardinality', index, end: 'to' });
  });
  m.notes.forEach((_n, index) => targets.push({ kind: 'note', index }));
  m.namespaces.forEach((n) => targets.push({ kind: 'namespace', id: n.id }));
  for (const t of targets) {
    const el = classElementFor(svg, m, t);
    expect(el, JSON.stringify(t)).not.toBeNull();
    expect(classTargetAt(el!, svg, m), JSON.stringify(t)).toEqual(t);
  }
  return targets;
}

describe('class SVG mapping (real-browser fixtures)', () => {
  it('rich diagram: classes, members, relations, cardinalities, notes, namespace', () => {
    const svg = load('class-rich.svg');
    const m = model(RICH);
    const at = (el: Element) => classTargetAt(el, svg, m);
    expect(at(byText(svg, 'Round thing'))).toEqual({ kind: 'class', id: 'Circle', part: 'title' });
    expect(at(byText(svg, '«interface»'))).toEqual({ kind: 'class', id: 'Shape', part: 'annotation' });
    expect(at(svg.querySelector('[id$="classId-Canvas-2"] .outer-path')!)).toEqual({ kind: 'class', id: 'Canvas', part: 'box' });
    // Rows → member indexes (fields and methods are separate groups).
    expect(at(byText(svg, '+double radius'))).toEqual({ kind: 'member', classId: 'Circle', index: 0 });
    expect(at(byText(svg, '-int id'))).toEqual({ kind: 'member', classId: 'Circle', index: 1 });
    expect(at(byText(svg, '+draw(Canvas c) : void'))).toEqual({ kind: 'member', classId: 'Circle', index: 2 });
    expect(at(byText(svg, '+render() : void'))).toEqual({ kind: 'member', classId: 'Canvas', index: 1 });
    expect(at(byText(svg, 'implements'))).toEqual({ kind: 'relation', index: 0, part: 'label' });
    expect(at(svg.querySelector('path[data-id="id_Canvas_Circle_3"]')!)).toEqual({ kind: 'relation', index: 2, part: 'line' });
    // Self loop: three pieces and helper nodes, all one relation.
    expect(at(svg.querySelector('path[data-id="Canvas-cyclic-special-2"]')!)).toEqual({ kind: 'relation', index: 3, part: 'line' });
    expect(at(byText(svg, 'self'))).toEqual({ kind: 'relation', index: 3, part: 'label' });
    expect(at(svg.querySelector('g.edgeLabel[id="Canvas---Canvas---1"]')!)).toEqual({ kind: 'relation', index: 3, part: 'line' });
    // Lollipop: its interface node and its line.
    expect(at(byText(svg, 'Drawable'))).toEqual({ kind: 'relation', index: 4, part: 'line' });
    expect(at(svg.querySelector('path[data-id="id_Circle_interface0_5"]')!)).toEqual({ kind: 'relation', index: 4, part: 'line' });
    expect(at(byText(svg, '1'))).toEqual({ kind: 'cardinality', index: 1, end: 'from' });
    expect(at(byText(svg, '*'))).toEqual({ kind: 'cardinality', index: 1, end: 'to' });
    expect(at(byText(svg, 'Global note'))).toEqual({ kind: 'note', index: 0 });
    expect(at(svg.querySelector('path[data-id="edgeNote1"]')!)).toEqual({ kind: 'note', index: 1 });
    expect(at(byText(svg, 'Shapes'))).toEqual({ kind: 'namespace', id: 'Shapes' });
    roundTrip(svg, m);
  });

  it('duplicate relations and ids with spaces / hyphens', () => {
    const svg = load('class-plain.svg');
    const m = model(PLAIN);
    expect(classTargetAt(svg.querySelector('path[data-id="id_Order-Item_Weird Name_2"]')!, svg, m)).toEqual({ kind: 'relation', index: 1, part: 'line' });
    expect(classTargetAt(byText(svg, 'Weird Name'), svg, m)).toEqual({ kind: 'class', id: 'Weird Name', part: 'title' });
    expect(classTargetAt(byText(svg, 'Order-Item'), svg, m)).toEqual({ kind: 'class', id: 'Order-Item', part: 'title' });
    roundTrip(svg, m);
  });

  it('the corpus class diagram', () => {
    const svg = load('class-corpus.svg');
    const src = corpusBlocks((b) => b.heading === 'class-diagram')[0].source;
    const m = model(src);
    expect(classTargetAt(byText(svg, '+int age'), svg, m)).toEqual({ kind: 'member', classId: 'Animal', index: 1 });
    expect(classTargetAt(byText(svg, 'chews'), svg, m)).toEqual({ kind: 'relation', index: 2, part: 'label' });
    roundTrip(svg, m);
  });

  it('is defensive: outside elements, unknown ids and model drift map to null or the box', () => {
    const svg = load('class-rich.svg');
    const m = model(RICH);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    expect(classTargetAt(outside, svg, m)).toBeNull();
    expect(classTargetAt(svg, svg, m)).toBeNull();
    // A model that no longer matches the picture (Circle lost a field).
    const drift = model(RICH.replace('            -int id$\n', ''));
    expect(classTargetAt(byText(svg, '+double radius'), svg, drift)).toEqual({ kind: 'class', id: 'Circle', part: 'box' });
    expect(classTargetAt(byText(svg, '1'), svg, model(RICH.replace('"1" o--', 'o--')))).toBeNull();
    expect(classElementFor(svg, m, { kind: 'member', classId: 'Nope', index: 0 })).toBeNull();
    expect(classElementFor(svg, m, { kind: 'relation', index: 99, part: 'line' })).toBeNull();
  });
});
