// The data diagram types (journey, quadrant, XY chart, Sankey, packet,
// radar): parsed into rows, and every edit changes only its own lines.
import { describe, it, expect } from 'vitest';
import { splitList, LineEditor } from '../../../src/lib/editor/mermaid/data-lines';
import { parseJourney, applyJourneyEdit, JOURNEY_STARTER } from '../../../src/lib/editor/mermaid/journey-data';
import { parseQuadrant, applyQuadrantEdit, QUADRANT_STARTER } from '../../../src/lib/editor/mermaid/quadrant-data';
import { parseXyChart, applyXyEdit, XYCHART_STARTER } from '../../../src/lib/editor/mermaid/xychart-data';
import { parseSankey, applySankeyEdit, csvFields, SANKEY_STARTER } from '../../../src/lib/editor/mermaid/sankey-data';
import { parsePacket, applyPacketEdit, PACKET_STARTER } from '../../../src/lib/editor/mermaid/packet-data';
import { parseRadar, applyRadarEdit, RADAR_STARTER } from '../../../src/lib/editor/mermaid/radar-data';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import { canEditDiagram } from '../../../src/lib/editor/mermaid/controller';
import '../../../src/lib/editor/mermaid/registry';

// The lines of b that differ from a's.
function changed(a: string, b: string): string[] {
  const al = a.split('\n');
  return b.split('\n').filter((l, i) => l !== al[i]);
}

describe('shared pieces', () => {
  it('splits lists, quoted items whole', () => {
    expect(splitList('a, "b, c", d')).toEqual(['a', 'b, c', 'd']);
    expect(splitList('')).toEqual([]);
    expect(splitList('"open')).toBeNull();
    expect(splitList('a"b')).toBeNull();
  });

  it('swaps two lines keeping each one\'s indentation', () => {
    expect(new LineEditor('x\n  a\n    b').swap(1, 2).toString()).toBe('x\n  b\n    a');
  });

  it('every starter is editable by its table editor', () => {
    for (const s of [JOURNEY_STARTER, QUADRANT_STARTER, XYCHART_STARTER, SANKEY_STARTER, PACKET_STARTER, RADAR_STARTER]) {
      expect(canEditDiagram(detectDiagramType(s), s), s.split('\n')[0]).toBe(true);
    }
  });
});

describe('journey', () => {
  const SRC = 'journey\n  title My day\n  %% a comment\n  section Go to work\n    Make tea: 5: Me\n    Go upstairs: 3: Me, Cat\n  section Home\n    Sit down: 4: Me\n';

  it('parses sections and steps', () => {
    const m = parseJourney(SRC)!;
    expect(m.title?.value).toBe('My day');
    expect(m.sections.map((s) => s.name)).toEqual(['Go to work', 'Home']);
    expect(m.sections[0].tasks[1]).toMatchObject({ name: 'Go upstairs', score: 3, people: ['Me', 'Cat'] });
  });

  it('a step: its name, feeling and people, on its own line only', () => {
    let out = applyJourneyEdit(SRC, { kind: 'setTask', section: 0, task: 1, field: 'score', value: 9 })!;
    expect(changed(SRC, out)).toEqual(['    Go upstairs: 5: Me, Cat']);
    out = applyJourneyEdit(SRC, { kind: 'setTask', section: 0, task: 0, field: 'name', value: 'Make: coffee' })!;
    expect(changed(SRC, out)).toEqual(['    Make - coffee: 5: Me']);
    out = applyJourneyEdit(SRC, { kind: 'setTask', section: 1, task: 0, field: 'people', value: 'Me,  Dog ,' })!;
    expect(changed(SRC, out)).toEqual(['    Sit down: 4: Me, Dog']);
  });

  it('adds, removes and reorders steps; adds and removes sections', () => {
    const added = applyJourneyEdit(SRC, { kind: 'addTask', section: 0 })!;
    expect(added.split('\n')[6]).toBe('    Task 4: 3: Me, Cat');
    expect(applyJourneyEdit(SRC, { kind: 'removeTask', section: 0, task: 0 })).not.toContain('Make tea');
    const moved = applyJourneyEdit(SRC, { kind: 'moveTask', section: 0, from: 0, to: 1 })!;
    expect(moved.split('\n').slice(4, 6)).toEqual(['    Go upstairs: 3: Me, Cat', '    Make tea: 5: Me']);
    const sec = applyJourneyEdit(SRC, { kind: 'addSection' })!;
    expect(sec.split('\n').slice(8, 10)).toEqual(['  section Section 3', '    New task: 3']);
    expect(applyJourneyEdit(SRC, { kind: 'removeSection', section: 1 })).toBe('journey\n  title My day\n  %% a comment\n  section Go to work\n    Make tea: 5: Me\n    Go upstairs: 3: Me, Cat\n');
  });

  it('a title is added under the header, and removed when emptied', () => {
    const noTitle = 'journey\n  section A\n    Step: 3: Me';
    expect(applyJourneyEdit(noTitle, { kind: 'setTitle', title: 'Trip' })).toBe('journey\n  title Trip\n  section A\n    Step: 3: Me');
    expect(applyJourneyEdit(SRC, { kind: 'setTitle', title: '' })).not.toContain('title');
  });

  it('anything it does not know: text-edited instead', () => {
    expect(parseJourney('journey\n  accDescr {\n  long\n  }\n')).toBeNull();
  });
});

describe('quadrant', () => {
  const SRC = 'quadrantChart\n    title Reach\n    x-axis Low Reach --> High Reach\n    y-axis Low --> High\n    quadrant-1 Expand\n    Campaign A: [0.3, 0.6]\n    Campaign B: [0.45, 0.23]\n';

  it('parses the labels and the points', () => {
    const m = parseQuadrant(SRC)!;
    expect(m.xAxis).toMatchObject({ low: 'Low Reach', high: 'High Reach' });
    expect(m.quadrants[0]?.value).toBe('Expand');
    expect(m.points.map((p) => [p.name, p.x, p.y])).toEqual([['Campaign A', 0.3, 0.6], ['Campaign B', 0.45, 0.23]]);
  });

  it('points stay between 0 and 1; names lose what the chart cannot hold', () => {
    expect(changed(SRC, applyQuadrantEdit(SRC, { kind: 'setPoint', index: 0, field: 'x', value: 1.4 })!)).toEqual(['    Campaign A: [1, 0.6]']);
    expect(changed(SRC, applyQuadrantEdit(SRC, { kind: 'setPoint', index: 1, field: 'name', value: 'B: [new]' })!)).toEqual(['    B new: [0.45, 0.23]']);
  });

  it('labels: changed in place, added after the others, removed when emptied', () => {
    expect(changed(SRC, applyQuadrantEdit(SRC, { kind: 'setAxis', axis: 'y', end: 'high', value: 'Loved' })!)).toEqual(['    y-axis Low --> Loved']);
    const q3 = applyQuadrantEdit(SRC, { kind: 'setQuadrant', index: 2, value: 'Drop' })!;
    expect(q3.split('\n')[5]).toBe('    quadrant-3 Drop');
    expect(applyQuadrantEdit(SRC, { kind: 'setQuadrant', index: 0, value: '' })).not.toContain('quadrant-1');
  });

  it('adds and removes points', () => {
    expect(applyQuadrantEdit(SRC, { kind: 'addPoint' })).toContain('    Point 3: [0.5, 0.5]\n');
    expect(applyQuadrantEdit(SRC, { kind: 'removePoint', index: 0 })).not.toContain('Campaign A');
  });

  it('styled points: text-edited instead', () => {
    expect(parseQuadrant('quadrantChart\n  Point A:::cls: [0.3, 0.6]')).toBeNull();
    expect(parseQuadrant('quadrantChart\n  Point A: [0.3, 0.6] radius: 12')).toBeNull();
  });
});

describe('XY chart', () => {
  const SRC = 'xychart-beta\n    title "Sales"\n    x-axis [jan, feb, "mar 2"]\n    y-axis "Revenue" 0 --> 100\n    bar [50, 60, 75]\n    line "Target" [55, 65, 70]\n';

  it('parses the categories and every series', () => {
    const m = parseXyChart(SRC)!;
    expect(m.xAxis?.categories).toEqual(['jan', 'feb', 'mar 2']);
    expect(m.yAxis).toMatchObject({ title: 'Revenue', min: 0, max: 100 });
    expect(m.series.map((s) => [s.kind, s.name, s.values])).toEqual([['bar', '', [50, 60, 75]], ['line', 'Target', [55, 65, 70]]]);
  });

  it('a value: just that series\' line', () => {
    expect(changed(SRC, applyXyEdit(SRC, { kind: 'setValue', row: 1, series: 1, value: 66.5 })!)).toEqual(['    line "Target" [55, 66.5, 70]']);
  });

  it('a category: the axis line, quoted when it needs to be', () => {
    expect(changed(SRC, applyXyEdit(SRC, { kind: 'setCategory', row: 0, value: 'Jan 1' })!)).toEqual(['    x-axis ["Jan 1", feb, "mar 2"]']);
  });

  it('rows: added, removed and moved across the axis and every series', () => {
    const add = applyXyEdit(SRC, { kind: 'addRow' })!;
    expect(parseXyChart(add)!.series.map((s) => s.values)).toEqual([[50, 60, 75, 0], [55, 65, 70, 0]]);
    const rm = applyXyEdit(SRC, { kind: 'removeRow', row: 0 })!;
    expect(parseXyChart(rm)!.xAxis?.categories).toEqual(['feb', 'mar 2']);
    const mv = applyXyEdit(SRC, { kind: 'moveRow', from: 2, to: 0 })!;
    expect(parseXyChart(mv)!.series[0].values).toEqual([75, 50, 60]);
  });

  it('settings: direction, scale (the right way round), series kind and name', () => {
    expect(applyXyEdit(SRC, { kind: 'setHorizontal', value: true })!.split('\n')[0]).toBe('xychart-beta horizontal');
    expect(applyXyEdit(SRC, { kind: 'setY', max: -5 })).toBeNull();
    expect(changed(SRC, applyXyEdit(SRC, { kind: 'setY', max: 200 })!)).toEqual(['    y-axis "Revenue" 0 --> 200']);
    expect(changed(SRC, applyXyEdit(SRC, { kind: 'setSeries', series: 0, field: 'kind', value: 'line' })!)).toEqual(['    line [50, 60, 75]']);
    expect(applyXyEdit(SRC, { kind: 'addSeries', seriesKind: 'bar' })).toContain('    bar [0, 0, 0]\n');
  });

  it('a numeric x-axis: text-edited instead', () => {
    expect(parseXyChart('xychart-beta\n  x-axis 1 --> 10\n  bar [1, 2]')).toBeNull();
  });
});

describe('Sankey', () => {
  const SRC = 'sankey-beta\n\n%% flows\nAgricultural waste,Bio-conversion,124.729\n"Gas, imported",Industry,25\n';

  it('reads quoted names with commas', () => {
    expect(csvFields('"a ""b"", c",d,3')).toEqual(['a "b", c', 'd', '3']);
    expect(parseSankey(SRC)!.flows.map((f) => [f.from, f.to, f.amount])).toEqual([
      ['Agricultural waste', 'Bio-conversion', 124.729],
      ['Gas, imported', 'Industry', 25],
    ]);
  });

  it('edits a flow on its line, quoting when needed', () => {
    expect(changed(SRC, applySankeyEdit(SRC, { kind: 'setFlow', index: 0, field: 'to', value: 'Heat, waste' })!)).toEqual([
      'Agricultural waste,"Heat, waste",124.729',
    ]);
    expect(applySankeyEdit(SRC, { kind: 'setFlow', index: 0, field: 'amount', value: -1 })).toBeNull();
  });

  it('adds a flow on from the last one', () => {
    expect(applySankeyEdit(SRC, { kind: 'addFlow' })).toContain('"Gas, imported",Industry,25\nIndustry,Destination 5,10');
  });
});

describe('packet', () => {
  const SRC = 'packet-beta\n  title UDP\n  0-15: "Source Port"\n  16-31: "Destination Port"\n  +16: "Length"\n  48: "Flag"\n';

  it('reads ranges, single bits and +sizes in order', () => {
    expect(parsePacket(SRC)!.fields.map((f) => [f.label, f.start, f.bits, f.form])).toEqual([
      ['Source Port', 0, 16, 'range'],
      ['Destination Port', 16, 16, 'range'],
      ['Length', 32, 16, 'plus'],
      ['Flag', 48, 1, 'bit'],
    ]);
  });

  it('a new size moves the fields after it, each in its own form', () => {
    const out = applyPacketEdit(SRC, { kind: 'setField', index: 0, field: 'bits', value: 8 })!;
    expect(out.split('\n').slice(2, 6)).toEqual(['  0-7: "Source Port"', '  8-23: "Destination Port"', '  +16: "Length"', '  40: "Flag"']);
  });

  it('removing closes the gap; moving renumbers', () => {
    const rm = applyPacketEdit(SRC, { kind: 'removeField', index: 0 })!;
    expect(rm.split('\n').slice(2)).toEqual(['  0-15: "Destination Port"', '  +16: "Length"', '  32: "Flag"', '']);
    const mv = applyPacketEdit(SRC, { kind: 'moveField', from: 3, to: 0 })!;
    expect(mv.split('\n').slice(2, 6)).toEqual(['  0: "Flag"', '  1-16: "Source Port"', '  17-32: "Destination Port"', '  +16: "Length"']);
  });
});

describe('radar', () => {
  const SRC = 'radar-beta\n  title Grades\n  axis m["Math"], s["Science"]\n  axis e["English"]\n  curve a["Alice"]{85, 90, 80}\n  curve b{70, 75, 85}\n  max 100\n  min 0\n  graticule polygon\n';

  it('reads axes across lines, curves and the scale', () => {
    const m = parseRadar(SRC)!;
    expect(m.axes.map((a) => [a.id, a.label])).toEqual([['m', 'Math'], ['s', 'Science'], ['e', 'English']]);
    expect(m.curves.map((c) => [c.id, c.label, c.values])).toEqual([['a', 'Alice', [85, 90, 80]], ['b', '', [70, 75, 85]]]);
    expect([m.max?.value, m.min?.value]).toEqual([100, 0]);
  });

  it('a score, or a measure\'s name, on its own line', () => {
    expect(changed(SRC, applyRadarEdit(SRC, { kind: 'setValue', row: 2, curve: 1, value: 60 })!)).toEqual(['  curve b{70, 75, 60}']);
    expect(changed(SRC, applyRadarEdit(SRC, { kind: 'setAxisLabel', row: 2, value: 'Writing' })!)).toEqual(['  axis e["Writing"]']);
  });

  it('adding a measure adds a score to every curve', () => {
    const out = applyRadarEdit(SRC, { kind: 'addAxis' })!;
    const m = parseRadar(out)!;
    expect(m.axes.map((a) => a.label)).toEqual(['Math', 'Science', 'English', 'Axis 4']);
    expect(m.curves.map((c) => c.values.length)).toEqual([4, 4]);
  });

  it('the scale stays the right way round', () => {
    expect(applyRadarEdit(SRC, { kind: 'setRange', end: 'max', value: -1 })).toBeNull();
    expect(changed(SRC, applyRadarEdit(SRC, { kind: 'setRange', end: 'max', value: 5 })!)).toEqual(['  max 5']);
  });

  it('curves written by axis name: text-edited instead', () => {
    expect(parseRadar('radar-beta\n  axis a, b\n  curve c{ a: 1, b: 2 }')).toBeNull();
  });
});
