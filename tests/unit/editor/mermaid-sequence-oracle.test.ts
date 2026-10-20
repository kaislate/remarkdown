// The sequence parser checked against mermaid's own parse of every
// sequence diagram in the corpora: same participants (order, display,
// actor or not, box), every message and note at the same place in
// mermaid's message list (that index names it in the SVG), same arrow,
// activation, blocks with their branches and `end` positions, boxes,
// numbering, title.
import { describe, it, expect, beforeAll } from 'vitest';
import { parseSequenceSource, decodeSequenceText } from '../../../src/lib/editor/mermaid-sequence-parser';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import { corpusBlocks, mermaidDb } from './mermaid-test-utils';

// jsdom has no CSS.supports; mermaid asks it whether a box's first word
// is a colour. Answer like a browser for the formats the corpora use.
beforeAll(() => {
  const named = new Set(['purple', 'lightyellow', 'aqua', 'red', 'green', 'blue', 'transparent']);
  (window.CSS as unknown as Record<string, unknown>).supports = (_p: string, v: string) =>
    /^(rgba?|hsla?)\(/i.test(v) || /^#[0-9a-f]{3,8}$/i.test(v) || named.has(String(v).toLowerCase());
});

// mermaid's LINETYPE numbers.
const LT = {
  SOLID: 0, DOTTED: 1, NOTE: 2, SOLID_CROSS: 3, DOTTED_CROSS: 4, SOLID_OPEN: 5, DOTTED_OPEN: 6,
  LOOP_START: 10, LOOP_END: 11, ALT_START: 12, ALT_ELSE: 13, ALT_END: 14, OPT_START: 15, OPT_END: 16,
  ACTIVE_START: 17, ACTIVE_END: 18, PAR_START: 19, PAR_AND: 20, PAR_END: 21, RECT_START: 22, RECT_END: 23,
  SOLID_POINT: 24, DOTTED_POINT: 25, AUTONUMBER: 26, CRITICAL_START: 27, CRITICAL_OPTION: 28, CRITICAL_END: 29,
  BREAK_START: 30, BREAK_END: 31, PAR_OVER_START: 32, BIDIRECTIONAL_SOLID: 33, BIDIRECTIONAL_DOTTED: 34,
};

const STYLE_TYPE: Record<string, number> = {
  solid: LT.SOLID_OPEN, arrow: LT.SOLID, dotted: LT.DOTTED_OPEN, reply: LT.DOTTED, cross: LT.SOLID_CROSS,
  dottedCross: LT.DOTTED_CROSS, async: LT.SOLID_POINT, dottedAsync: LT.DOTTED_POINT, both: LT.BIDIRECTIONAL_SOLID,
  dottedBoth: LT.BIDIRECTIONAL_DOTTED,
};

const BLOCK_TYPES: Record<string, [number[], number, number]> = {
  loop: [[LT.LOOP_START], -1, LT.LOOP_END],
  alt: [[LT.ALT_START], LT.ALT_ELSE, LT.ALT_END],
  opt: [[LT.OPT_START], -1, LT.OPT_END],
  par: [[LT.PAR_START, LT.PAR_OVER_START], LT.PAR_AND, LT.PAR_END],
  critical: [[LT.CRITICAL_START], LT.CRITICAL_OPTION, LT.CRITICAL_END],
  break: [[LT.BREAK_START], -1, LT.BREAK_END],
  rect: [[LT.RECT_START], -1, LT.RECT_END],
};

// mermaid's db text → what it draws (entity placeholders undone).
function shown(text: unknown): string {
  const s = typeof text === 'string' ? text : '';
  return decodeSequenceText(s.replace(/ﬂ°°(\d+)¶ß/g, '#$1;').replace(/ﬂ°(\w+)¶ß/g, '#$1;'));
}

const blocks = [
  ...corpusBlocks((b) => detectDiagramType(b.source) === 'sequence'),
  ...corpusBlocks((b) => detectDiagramType(b.source) === 'sequence', ['mermaid-corpus-sequence.md']),
];

describe('sequence parser vs mermaid', () => {
  it('covers the corpora', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(17);
  });

  for (const b of blocks) {
    it(`${b.heading}: same diagram as mermaid`, async () => {
      const r = parseSequenceSource(b.source);
      expect(r.ok, r.ok ? '' : r.reason).toBe(true);
      if (!r.ok) return;
      const { graph, map } = r;
      const { db } = await mermaidDb(b.source);
      const msgs = db.getMessages() as Array<{ type: number; from?: string; to?: string; message: unknown }>;

      // Participants.
      const actors = [...db.getActors().values()] as Array<{ name: string; description: string; type: string; box?: { name?: string } }>;
      expect([...graph.participants.keys()], 'participant order').toEqual(actors.map((a) => a.name));
      for (const a of actors) {
        const p = graph.participants.get(a.name)!;
        expect(p.display || p.id, `${a.name} display`).toBe(shown(a.description));
        expect(p.kind ?? 'participant', `${a.name} kind`).toBe(a.type);
      }

      // Messages and notes, at mermaid's own message index.
      graph.events.forEach((ev, i) => {
        const src = map.events[i];
        const m = msgs[src.mermaidIndex];
        expect(m, `event ${i} at i${src.mermaidIndex}`).toBeDefined();
        if (ev.kind === 'note') {
          expect(m.type, `event ${i} is a note`).toBe(LT.NOTE);
          expect(shown(m.message), `note ${i} text`).toBe(ev.text);
          return;
        }
        expect([m.from, m.to], `message ${i} ends`).toEqual([ev.from, ev.to]);
        expect(shown(m.message), `message ${i} text`).toBe(ev.text);
        if (ev.style !== 'other') expect(m.type, `message ${i} arrow`).toBe(STYLE_TYPE[ev.style]);
        const next = msgs[src.mermaidIndex + 1];
        if (ev.activation === 'activate') expect([next?.type, next?.from], `message ${i} activates`).toEqual([LT.ACTIVE_START, ev.to]);
        else if (ev.activation === 'deactivate') expect([next?.type, next?.from], `message ${i} deactivates`).toEqual([LT.ACTIVE_END, ev.from]);
        else expect([LT.ACTIVE_START, LT.ACTIVE_END].includes(next?.type ?? -1) && next?.from === undefined, `message ${i} no mark`).toBe(false);
      });

      // Blocks: their opening, branches and end in mermaid's list.
      graph.blocks.forEach((blk, k) => {
        const src = map.blocks[k];
        const [starts, branchType, endType] = BLOCK_TYPES[blk.kind];
        expect(msgs[src.endIndex]?.type, `block ${k} end`).toBe(endType);
        // Its opening is the message before its first event's (or the
        // end's) position, counting back over what's inside.
        const opening = msgs.findIndex((m, idx) => starts.includes(m.type) && idx < src.endIndex && shown(m.message) === (blk.kind === 'rect' ? blk.label : blk.label));
        expect(opening, `block ${k} opening`).toBeGreaterThanOrEqual(0);
        const branchMsgs = msgs.filter((m, idx) => idx > opening && idx < src.endIndex && m.type === branchType).map((m) => shown(m.message));
        // Nested blocks of the same kind have their own branches; only
        // compare when no same-kind block is nested inside.
        const nestedSame = graph.blocks.some((o, j) => j !== k && o.kind === blk.kind && o.start >= blk.start && o.end <= blk.end && j > k);
        if (!nestedSame) expect(branchMsgs, `block ${k} branches`).toEqual(blk.branches);
      });

      // Boxes.
      const boxes = db.getBoxes() as Array<{ name?: string; fill: string; actorKeys: string[] }>;
      expect(boxes.length, 'box count').toBe(graph.boxes.length);
      boxes.forEach((bx, k) => {
        expect(graph.boxes[k].participants, `box ${k} members`).toEqual(bx.actorKeys);
        expect(graph.boxes[k].label, `box ${k} label`).toBe(bx.name ? shown(bx.name) : '');
        if (graph.boxes[k].color) expect(bx.fill, `box ${k} colour`).toBe(graph.boxes[k].color);
      });

      // Numbering and title.
      const numbered = msgs.some((m) => m.type === LT.AUTONUMBER && (m.message as { visible?: boolean })?.visible);
      expect(graph.autonumber, 'autonumber').toBe(numbered);
      expect(graph.title, 'title').toBe(shown(db.getDiagramTitle?.() ?? ''));
    });
  }
});
