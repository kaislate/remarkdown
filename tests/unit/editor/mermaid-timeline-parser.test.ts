import { describe, it, expect } from 'vitest';
import {
  parseTimeline,
  parseTimelineSource,
  TIMELINE_STARTER,
  type TimelineModel,
} from '../../../src/lib/editor/mermaid/timeline-parser';
import { timelineDrawOrder } from '../../../src/lib/editor/mermaid/timeline-svg';
import { corpusBlocks, mermaidAccepts } from './mermaid-test-utils';
import { EXTRA_CORPUS, oracleDb, oracleText, renderSvg, shownText } from './mermaid-oracle-utils';

function model(src: string): TimelineModel {
  const r = parseTimeline(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

describe('timeline parser', () => {
  it('reads the corpus timeline', () => {
    expect(model('timeline\n    title History of social media\n    2002 : LinkedIn\n    2004 : Facebook : Google\n    2005 : YouTube\n')).toEqual({
      title: 'History of social media',
      direction: 'LR',
      sections: [],
      periods: [
        { label: '2002', section: null, events: ['LinkedIn'] },
        { label: '2004', section: null, events: ['Facebook', 'Google'] },
        { label: '2005', section: null, events: ['YouTube'] },
      ],
    });
  });

  it('reads sections, continuation lines and directions', () => {
    const m = model('timeline TD\n  section A\n    2001 : x\n         : y\n    2002\n  section B\n    2003 : z : w\n         : v\n');
    expect(m.direction).toBe('TD');
    expect(m.sections).toEqual([{ name: 'A' }, { name: 'B' }]);
    expect(m.periods).toEqual([
      { label: '2001', section: 0, events: ['x', 'y'] },
      { label: '2002', section: 0, events: [] },
      { label: '2003', section: 1, events: ['z', 'w', 'v'] },
    ]);
  });

  it('reads text the way mermaid shows it', () => {
    const m = model(
      'timeline\n  title  Ups #amp; downs %% not a comment\n  section  S #59; 1  \n  2001 # a comment : not an event\n  2002 : a:b : c  :  d\n  2003 %% kept : e # kept\n',
    );
    expect(m.title).toBe('Ups & downs %% not a comment');
    expect(m.sections).toEqual([{ name: 'S ; 1' }]);
    expect(m.periods).toEqual([
      { label: '2001', section: 0, events: [] },
      { label: '2002', section: 0, events: ['a:b', 'c', 'd'] },
      { label: '2003 %% kept', section: 0, events: ['e # kept'] },
    ]);
  });

  it('skips comments, directives, accessibility statements and blank lines', () => {
    const src = '---\ntitle: Yaml\n---\n%%{init: {"theme": "forest"}}%%\ntimeline\n  %% c\n  accTitle: a\n  accDescr: b\n  accDescr {\n    multi\n  }\n\n  2001 : x\n';
    // mermaid ignores a frontmatter title on timelines.
    expect(model(src)).toEqual({ title: '', direction: 'LR', sections: [], periods: [{ label: '2001', section: null, events: ['x'] }] });
  });

  it('records where each part sits', () => {
    const r = parseTimelineSource('timeline\n  title T\n  section S\n  2004 : Facebook : Google\n       : YouTube\n  2005\n');
    if (!r.ok) throw new Error(r.reason);
    expect(r.map.titles).toEqual([{ line: 1, value: { start: 8, end: 9 }, cut: null }]);
    expect(r.map.sections).toEqual([{ line: 2, name: { start: 10, end: 11 } }]);
    expect(r.map.periods[0]).toEqual({
      line: 3,
      lastLine: 4,
      label: { start: 2, end: 6 },
      events: [
        { line: 3, colon: 7, text: { start: 9, end: 17 } },
        { line: 3, colon: 18, text: { start: 20, end: 26 } },
        { line: 4, colon: 7, text: { start: 9, end: 16 } },
      ],
    });
    expect(r.map.periods[1]).toEqual({ line: 5, lastLine: 5, label: { start: 2, end: 6 }, events: [] });
  });

  it('refuses what it cannot read', () => {
    expect(parseTimeline('pie\n  "a" : 1\n').ok).toBe(false);
    // mermaid rejects these
    expect(parseTimeline('timeline\n  2002 :a\n').ok).toBe(false);
    expect(parseTimeline('timeline\n  : orphan event\n').ok).toBe(false);
    // valid but odd layouts the editor leaves render-only
    expect(parseTimeline('timeline title X\n  2002\n').ok).toBe(false);
    expect(parseTimeline('timeline\n  2001 : a\n  section S\n  : b\n').ok).toBe(false);
    expect(parseTimeline('timeline\n  2001 :\n  2002 : b\n').ok).toBe(false);
    expect(parseTimeline('timeline\n  section S : x\n').ok).toBe(false);
  });

  it('the starter is a valid, editable timeline', async () => {
    expect(await mermaidAccepts(TIMELINE_STARTER)).toBe(true);
    expect(model(TIMELINE_STARTER).periods.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Oracle ───────────────────────────────────────────────────────────

const isTimeline = (b: { source: string }) => /^\s*timeline\b/m.test(b.source);
// mermaid draws each <br> as a line break; the model holds a '\n'.
const lines = (raw: string) => String(raw).split('<br>').map(oracleText).join('\n');
const blocks = corpusBlocks(isTimeline, ['mermaid-corpus.md', EXTRA_CORPUS]);

describe('timeline parser: oracle over the corpus', () => {
  it('reads every corpus timeline', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    for (const b of blocks) expect(parseTimeline(b.source).ok, b.heading).toBe(true);
  });

  for (const b of blocks) {
    it(`${b.heading}: matches mermaid's db`, async () => {
      const m = model(b.source);
      const { db, title } = await oracleDb(b.source);
      expect(m.title).toBe(title);
      expect(m.direction).toBe(db.getDirection());
      expect(m.sections.map((s) => s.name)).toEqual(db.getSections().map(lines));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tasks = db.getTasks().map((t: any) => ({ label: lines(t.task), section: lines(t.section), events: t.events.map(lines) }));
      expect(m.periods.map((p) => ({ label: p.label, section: p.section === null ? '' : m.sections[p.section].name, events: p.events }))).toEqual(tasks);
    });

    it(`${b.heading}: matches what mermaid draws`, async () => {
      const m = model(b.source);
      const svg = await renderSvg(b.source);
      const drawn = Array.from(svg.querySelectorAll('g.timeline-node')).map(shownText);
      const expected = timelineDrawOrder(m).map((t) =>
        t.kind === 'section' ? m.sections[t.index].name : t.kind === 'period' ? m.periods[t.index].label : m.periods[t.period].events[t.index],
      );
      expect(drawn).toEqual(expected.map((t) => t.replace(/\s+/g, ' ').trim()));
    });
  }
});
