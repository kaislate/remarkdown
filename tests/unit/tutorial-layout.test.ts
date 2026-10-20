import { describe, it, expect } from 'vitest';
import { placeTips, labelBox, separate, arrowPaths, type Rect, type Anchors } from '../../src/lib/tutorial-layout';

const rect = (left: number, top: number, width: number, height: number): Rect =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

const WIN = { width: 1280, height: 800 };
const base = (): Anchors => ({
  window: WIN,
  page: rect(0, 0, 1280, 800),
  menu: rect(14, 14, 38, 38),
  edit: rect(14, 60, 38, 38),
  contents: rect(14, 106, 38, 38),
  reader: rect(14, 152, 38, 38),
  controls: rect(1148, 0, 132, 38),
  minimap: rect(1124, 52, 140, 638),
  tools: rect(1042, 730, 216, 48),
  remarks: rect(49, 694, 86, 38),
  zoom: rect(22, 740, 118, 40),
});

const ids = (a: Anchors) => placeTips(a).tips.map((t) => t.id);

describe('placing the tutorial tips', () => {
  it('a tip for every control on screen, pointing at it', () => {
    const { tips, bracket } = placeTips(base());
    expect(tips.map((t) => t.id)).toEqual(['menu', 'edit', 'contents', 'reader', 'drag', 'drop', 'tools', 'remarks', 'zoom']);
    const reader = tips.find((t) => t.id === 'reader')!;
    expect(reader.point).toEqual({ x: 58, y: 171 }); // just right of the reader button
    expect(bracket).toMatchObject({ x: 1094, top: 60, bottom: 682 });
  });

  it("a control that isn't shown gets no tip (annotation tools hidden, minimap tucked away)", () => {
    const a = base();
    delete a.tools;
    delete a.remarks;
    delete a.minimap;
    expect(ids(a)).not.toContain('tools');
    expect(ids(a)).not.toContain('remarks');
    expect(placeTips(a).bracket).toBeUndefined();
  });

  it('follows the controls when the tab sidebar moves them over', () => {
    const a = base();
    for (const k of ['menu', 'edit', 'contents', 'reader'] as const) a[k] = { ...a[k]!, left: a[k]!.left + 200, right: a[k]!.right + 200 };
    a.zoom = { ...a.zoom!, left: 222, right: 340 };
    a.tabsLeft = { last: rect(8, 136, 184, 32), sidebar: rect(0, 60, 200, 740) };
    const { tips } = placeTips(a);
    expect(tips.find((t) => t.id === 'edit')!.point!.x).toBe(258);
    expect(tips.find((t) => t.id === 'zoom')!.point!.x).toBe(346);
    // The tabs' tip sits under the sidebar's list, pointing up at it.
    const tabs = tips.find((t) => t.id === 'tabs')!;
    expect(tabs.point).toEqual({ x: 40, y: 174 });
    expect(tabs.at.y).toBeGreaterThan(174);
  });

  it('with tabs on top: a tip for the tabs, and the drag tip points past them', () => {
    const a = base();
    a.tabsTop = { active: rect(354, 4, 96, 30), end: rect(456, 6, 26, 26) };
    const { tips } = placeTips(a);
    expect(tips.find((t) => t.id === 'tabs')!.point).toEqual({ x: 469, y: 36 });
    const drag = tips.find((t) => t.id === 'drag')!;
    expect(drag.point!.x).toBe((482 + 1148) / 2);
  });

  it('labels never cover one another, and stay in the window', () => {
    const boxes = [
      { id: 'menu' as const, box: rect(124, 40, 260, 34), nudge: 'down' as const },
      { id: 'tabs' as const, box: rect(300, 50, 280, 34), nudge: 'down' as const },
      { id: 'zoom' as const, box: rect(200, 770, 200, 34), nudge: 'up' as const },
    ];
    const dismiss = rect(500, 700, 280, 90);
    const out = separate([...boxes, { id: 'drop' as const, box: rect(560, 720, 200, 34), nudge: 'up' as const }], WIN, [dismiss]);
    expect(out.get('drop')!.bottom).toBeLessThanOrEqual(dismiss.top - 8);
    const m = out.get('menu')!;
    const t = out.get('tabs')!;
    expect(t.top).toBeGreaterThanOrEqual(m.bottom + 8);
    expect(out.get('zoom')!.bottom).toBeLessThanOrEqual(792);
  });

  it('labelBox honours the alignment', () => {
    const box = labelBox({ id: 'tools', at: { x: 1000, y: 700 }, alignX: 'right', alignY: 'bottom', nudge: 'up' }, { width: 200, height: 30 });
    expect(box).toEqual(rect(800, 670, 200, 30));
  });

  it('arrows start at the label edge facing the control and end just short of it', () => {
    const { line, head } = arrowPaths(rect(124, 50, 200, 34), { x: 58, y: 33 });
    expect(line.startsWith('M 118,')).toBe(true);
    expect(head.startsWith('M ')).toBe(true);
    const tip = head.slice(2).split(' L ')[0].split(',').map(Number);
    expect(Math.hypot(tip[0] - 58, tip[1] - 33)).toBeLessThan(3);
  });
});
