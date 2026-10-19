// ER diagram click-target mapping, against SVG captured from the app
// in a real browser (tests/fixtures/mermaid-svg/er-*.svg; the sources
// below are exactly what was rendered).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { erTargetAt, erElementFor, type ErTarget } from '../../../src/lib/editor/mermaid/er-svg';
import { parseEr, type ErModel } from '../../../src/lib/editor/mermaid/er-parser';
import { corpusBlocks } from './mermaid-test-utils';

const RICH = [
  'erDiagram',
  '    CUSTOMER ||--o{ ORDER : places',
  '    ORDER ||--|{ LINE-ITEM : contains',
  '    CUSTOMER ||--o{ ORDER : returns',
  '    EMPLOYEE ||--o{ EMPLOYEE : manages',
  '    CUSTOMER["Customer"] {',
  '        string name "full name"',
  '        string email PK, FK',
  '    }',
  '    "Line Item" {',
  '        int qty',
  '    }',
  '    ORDER {',
  '        int id PK',
  '    }',
  '',
].join('\n');

function load(file: string): SVGSVGElement {
  document.body.innerHTML = readFileSync(resolve(__dirname, '../../fixtures/mermaid-svg', file), 'utf8');
  return document.querySelector('svg') as unknown as SVGSVGElement;
}

function model(src: string): ErModel {
  const r = parseEr(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

function byText(svg: Element, text: string, nth = -1): Element {
  const hit = [...svg.querySelectorAll('p')].filter((e) => e.textContent === text);
  if (!hit.length) throw new Error(`no element with text ${text}`);
  return nth < 0 ? hit[hit.length - 1] : hit[nth];
}

function roundTrip(svg: SVGSVGElement, m: ErModel): void {
  const targets: ErTarget[] = [];
  for (const [id, e] of m.entities) {
    targets.push({ kind: 'entity', id, part: 'box' }, { kind: 'entity', id, part: 'title' });
    e.attributes.forEach((_a, index) => {
      for (const cell of ['type', 'name', 'keys', 'comment', 'row'] as const) targets.push({ kind: 'attribute', entityId: id, index, cell });
    });
  }
  m.relationships.forEach((_r, index) => targets.push({ kind: 'relationship', index, part: 'line' }, { kind: 'relationship', index, part: 'label' }));
  for (const t of targets) {
    const el = erElementFor(svg, m, t);
    expect(el, JSON.stringify(t)).not.toBeNull();
    expect(erTargetAt(el!, svg, m), JSON.stringify(t)).toEqual(t);
  }
}

describe('ER SVG mapping (real-browser fixtures)', () => {
  it('entities, attribute cells and rows, duplicate and self relationships', () => {
    const svg = load('er-rich.svg');
    const m = model(RICH);
    const at = (el: Element) => erTargetAt(el, svg, m);
    expect(at(byText(svg, 'Customer'))).toEqual({ kind: 'entity', id: 'CUSTOMER', part: 'title' });
    expect(at(byText(svg, 'LINE-ITEM'))).toEqual({ kind: 'entity', id: 'LINE-ITEM', part: 'title' });
    expect(at(byText(svg, 'Line Item'))).toEqual({ kind: 'entity', id: 'Line Item', part: 'title' });
    expect(at(byText(svg, 'email'))).toEqual({ kind: 'attribute', entityId: 'CUSTOMER', index: 1, cell: 'name' });
    expect(at(byText(svg, 'PK,FK'))).toEqual({ kind: 'attribute', entityId: 'CUSTOMER', index: 1, cell: 'keys' });
    expect(at(byText(svg, 'full name'))).toEqual({ kind: 'attribute', entityId: 'CUSTOMER', index: 0, cell: 'comment' });
    const customer = svg.querySelector('[id$="entity-CUSTOMER-0"]')!;
    expect(at(customer.querySelector('.row-rect-even path')!)).toEqual({ kind: 'attribute', entityId: 'CUSTOMER', index: 1, cell: 'row' });
    expect(at(customer.querySelector('.outer-path')!)).toEqual({ kind: 'entity', id: 'CUSTOMER', part: 'box' });
    expect(at(byText(svg, 'returns'))).toEqual({ kind: 'relationship', index: 2, part: 'label' });
    expect(at(svg.querySelector('path[data-id="id_entity-CUSTOMER-0_entity-ORDER-1_0"]')!)).toEqual({ kind: 'relationship', index: 0, part: 'line' });
    expect(at(svg.querySelector('path[data-id="entity-EMPLOYEE-3-cyclic-special-1"]')!)).toEqual({ kind: 'relationship', index: 3, part: 'line' });
    expect(at(byText(svg, 'manages'))).toEqual({ kind: 'relationship', index: 3, part: 'label' });
    expect(at(svg.querySelector('g.edgeLabel[id="entity-EMPLOYEE-3---entity-EMPLOYEE-3---2"]')!)).toEqual({ kind: 'relationship', index: 3, part: 'line' });
    roundTrip(svg, m);
  });

  it('the corpus ER diagram', () => {
    const svg = load('er-corpus.svg');
    const m = model(corpusBlocks((b) => b.heading === 'er-diagram')[0].source);
    expect(erTargetAt(byText(svg, 'created'), svg, m)).toEqual({ kind: 'attribute', entityId: 'ORDER', index: 1, cell: 'name' });
    roundTrip(svg, m);
  });

  it('is defensive about model drift', () => {
    const svg = load('er-rich.svg');
    const drift = model(RICH.replace('        string email PK, FK\n', ''));
    expect(erTargetAt(byText(svg, 'email'), svg, drift)).toEqual({ kind: 'entity', id: 'CUSTOMER', part: 'box' });
    expect(erTargetAt(svg, svg, drift)).toBeNull();
    expect(erElementFor(svg, drift, { kind: 'attribute', entityId: 'CUSTOMER', index: 5, cell: 'name' })).toBeNull();
  });
});
