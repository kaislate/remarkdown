// Where the welcome tutorial's tips go, worked out from where the controls
// they explain actually are (WelcomeOverlay measures them). The controls
// move — tabs on top or in a sidebar, the sidebar pinned or not, the
// window resized — so no tip has a fixed place: each points at its control,
// and a tip whose control isn't on screen isn't shown.

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Point { x: number; y: number }

export type TipId =
  | 'menu' | 'edit' | 'contents' | 'reader'
  | 'tabs' | 'drag' | 'drop' | 'minimap' | 'tools' | 'remarks' | 'zoom';

// The controls' boxes on screen, as measured (absent = not shown).
export interface Anchors {
  window: { width: number; height: number };
  page: Rect;
  menu?: Rect;
  edit?: Rect;
  contents?: Rect;
  reader?: Rect;
  // Tabs: on top (the + button ends the strip) or the sidebar's first row.
  tabsTop?: { active: Rect; end: Rect };
  tabsLeft?: { last: Rect; sidebar: Rect }; // last: the sidebar list's last row
  controls?: Rect; // the window buttons
  minimap?: Rect;
  tools?: Rect;
  remarks?: Rect;
  zoom?: Rect;
}

// A label's position: `at` is the point of the label box named by
// `alignX` / `alignY`; `nudge` is the way it gives room if it would cover
// another label. `point` is what its arrow points at (none for the drop
// hint).
export interface Tip {
  id: TipId;
  at: Point;
  alignX: 'left' | 'center' | 'right';
  alignY: 'top' | 'middle' | 'bottom';
  nudge: 'down' | 'up';
  point?: Point;
}

export interface Bracket { x: number; top: number; bottom: number; label: Point }

const cx = (r: Rect) => (r.left + r.right) / 2;
const cy = (r: Rect) => (r.top + r.bottom) / 2;

export function placeTips(a: Anchors): { tips: Tip[]; bracket?: Bracket } {
  const tips: Tip[] = [];

  // The round buttons down the left: a column of labels beside them, each
  // level with its button but a little lower, so the menu's label clears
  // the top edge (where top tabs sit).
  const column = (['menu', 'edit', 'contents', 'reader'] as const)
    .map((id) => ({ id, r: a[id] }))
    .filter((b): b is { id: typeof b.id; r: Rect } => !!b.r);
  const columnRight = Math.max(0, ...column.map((b) => b.r.right));
  for (const b of column) {
    tips.push({
      id: b.id,
      point: { x: b.r.right + 6, y: cy(b.r) },
      at: { x: columnRight + 72, y: cy(b.r) + 20 },
      alignX: 'left',
      alignY: 'middle',
      nudge: 'down',
    });
  }

  // Tabs on top: from the end of the strip. In the sidebar: from below
  // its list, the label underneath.
  if (a.tabsTop) {
    const e = a.tabsTop.end;
    tips.push({ id: 'tabs', point: { x: cx(e), y: e.bottom + 4 }, at: { x: cx(e) + 34, y: e.bottom + 44 }, alignX: 'left', alignY: 'top', nudge: 'down' });
  } else if (a.tabsLeft) {
    const l = a.tabsLeft.last;
    const x = a.tabsLeft.sidebar.left + 40;
    tips.push({ id: 'tabs', point: { x, y: l.bottom + 6 }, at: { x: a.tabsLeft.sidebar.left + 12, y: l.bottom + 52 }, alignX: 'left', alignY: 'top', nudge: 'down' });
  }

  // Dragging the window: the empty top edge — past the tabs if they're on
  // top, else the middle — short of the window buttons.
  const right = a.controls?.left ?? a.window.width;
  const left = a.tabsTop ? a.tabsTop.end.right : 0;
  const dragX = a.tabsTop ? (left + right) / 2 : a.window.width / 2;
  tips.push({ id: 'drag', point: { x: dragX, y: 14 }, at: { x: dragX, y: 64 }, alignX: 'center', alignY: 'top', nudge: 'down' });

  // Dropping a file: anywhere, so in the middle of the page, no arrow.
  tips.push({ id: 'drop', at: { x: cx(a.page), y: a.page.top + a.page.height * 0.42 }, alignX: 'center', alignY: 'middle', nudge: 'down' });

  if (a.tools) {
    const t = a.tools;
    tips.push({ id: 'tools', point: { x: t.left + 18, y: t.top - 6 }, at: { x: t.left - 24, y: t.top - 44 }, alignX: 'right', alignY: 'bottom', nudge: 'up' });
  }
  if (a.remarks) {
    const r = a.remarks;
    tips.push({ id: 'remarks', point: { x: cx(r), y: r.top - 6 }, at: { x: r.left + 28, y: r.top - 50 }, alignX: 'left', alignY: 'bottom', nudge: 'up' });
  }
  if (a.zoom) {
    const z = a.zoom;
    tips.push({ id: 'zoom', point: { x: z.right + 6, y: cy(z) }, at: { x: z.right + 56, y: cy(z) - 4 }, alignX: 'left', alignY: 'middle', nudge: 'up' });
  }

  let bracket: Bracket | undefined;
  if (a.minimap) {
    const m = a.minimap;
    const x = m.left - 30;
    bracket = { x, top: m.top + 8, bottom: m.bottom - 8, label: { x: x - 8, y: cy(m) } };
  }
  return { tips, bracket };
}

// The box a label of `size` occupies at its tip's position.
export function labelBox(tip: Tip, size: { width: number; height: number }): Rect {
  const left = tip.alignX === 'left' ? tip.at.x : tip.alignX === 'right' ? tip.at.x - size.width : tip.at.x - size.width / 2;
  const top = tip.alignY === 'top' ? tip.at.y : tip.alignY === 'bottom' ? tip.at.y - size.height : tip.at.y - size.height / 2;
  return { left, top, right: left + size.width, bottom: top + size.height, width: size.width, height: size.height };
}

const overlaps = (p: Rect, q: Rect, gap: number) =>
  p.left < q.right + gap && p.right + gap > q.left && p.top < q.bottom + gap && p.bottom + gap > q.top;

// Moves labels (in order) up or down until none covers another or any of
// the `obstacles` (the dismiss buttons), and keeps them inside the window.
// Returns the final boxes.
export function separate(
  boxes: Array<{ id: TipId; box: Rect; nudge: 'down' | 'up' }>,
  win: { width: number; height: number },
  obstacles: Rect[] = [],
  gap = 8,
): Map<TipId, Rect> {
  const placed = new Map<TipId, Rect>();
  for (const { id, box, nudge } of boxes) {
    let b = { ...box };
    for (let guard = 0; guard < 20; guard++) {
      const hit = [...obstacles, ...placed.values()].find((p) => overlaps(b, p, gap));
      if (!hit) break;
      const dy = nudge === 'down' ? hit.bottom + gap - b.top : hit.top - gap - b.bottom;
      b = { ...b, top: b.top + dy, bottom: b.bottom + dy };
    }
    const dx = Math.max(8 - b.left, Math.min(0, win.width - 8 - b.right));
    const dy = Math.max(8 - b.top, Math.min(0, win.height - 8 - b.bottom));
    placed.set(id, { ...b, left: b.left + dx, right: b.right + dx, top: b.top + dy, bottom: b.bottom + dy });
  }
  return placed;
}

// A hand-drawn-looking arrow from the label's edge facing `to`, bowing a
// little, with its head stopping just short of the control.
export function arrowPaths(from: Rect, to: Point): { line: string; head: string } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  let s: Point;
  if (to.x < from.left) s = { x: from.left - 6, y: clamp(to.y, from.top + 8, from.bottom - 8) };
  else if (to.x > from.right) s = { x: from.right + 6, y: clamp(to.y, from.top + 8, from.bottom - 8) };
  else if (to.y < from.top) s = { x: clamp(to.x, from.left + 12, from.right - 12), y: from.top - 6 };
  else s = { x: clamp(to.x, from.left + 12, from.right - 12), y: from.bottom + 6 };
  const dx = to.x - s.x;
  const dy = to.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  // Bow to one side by a fifth of the length.
  const c = { x: (s.x + to.x) / 2 - (dy / len) * len * 0.2, y: (s.y + to.y) / 2 + (dx / len) * len * 0.2 };
  // Head along the curve's direction at its end.
  const hx = to.x - c.x;
  const hy = to.y - c.y;
  const hl = Math.hypot(hx, hy) || 1;
  const ux = hx / hl;
  const uy = hy / hl;
  const tip = { x: to.x - ux * 2, y: to.y - uy * 2 };
  const base = { x: tip.x - ux * 13, y: tip.y - uy * 13 };
  const n = { x: -uy * 6.5, y: ux * 6.5 };
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    line: `M ${r(s.x)},${r(s.y)} Q ${r(c.x)},${r(c.y)} ${r(base.x)},${r(base.y)}`,
    head: `M ${r(tip.x)},${r(tip.y)} L ${r(base.x + n.x)},${r(base.y + n.y)} L ${r(base.x - n.x)},${r(base.y - n.y)} Z`,
  };
}
