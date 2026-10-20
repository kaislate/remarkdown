// Ink from the pointer in reader mode (components/ReaderCursorInk.svelte
// hosts it: the canvas, the pointer, scrolling, the frame loop). Grey ink,
// in the page's own text colour laid down thin, in one of a few styles:
//
//   leak  — resting the mouse lets ink leak from it: a spot that soaks
//           into the paper and keeps spreading (fast at first, then slower)
//           while the pointer stays put. Move far enough away, or scroll
//           the page out from under it, and it stops and dries away; the
//           next rest starts a new one. Small wobbles don't count.
//   trail — drops fall along the pointer's path, bleed out and dry; a rest
//           soaks in a larger blot.
//   pen   — a fine wet line follows the pointer, feathers into the paper
//           and dries away behind it.
//
// Every painter works in window (CSS) pixels; the spots lie in the paper,
// so they move with the page when it scrolls.

export const CURSOR_INK_STYLES = ['leak', 'trail', 'pen', 'off'] as const;
export type CursorInkStyle = (typeof CURSOR_INK_STYLES)[number];

export type Rgb = [number, number, number];

export interface InkPainter {
  move(x: number, y: number, now: number): void;
  // The pointer has been still for REST_MS.
  rest(x: number, y: number, now: number): void;
  // The page moved by dy (and the pointer, relative to it, the other way).
  scroll(dy: number, pointer: { x: number; y: number } | null, now: number): void;
  // The pointer left the window.
  leave(now: number): void;
  // Draws a frame; true while something is still moving.
  draw(ctx: CanvasRenderingContext2D, now: number, ink: Rgb): boolean;
}

export const REST_MS = 320;

const rgba = (ink: Rgb, a: number) => `rgba(${ink[0]},${ink[1]},${ink[2]},${a})`;

// ── leak ─────────────────────────────────────────────────────────────────

const AWAY = 26; // px from a spot's centre that counts as moving away
const R0 = 2.5; // px, the first drop
const K = 0.42; // spread: radius grows by K·√ms…
const R_MAX = 90; // …up to this
const APPEAR = 220; // ms for the first drop to darken
const FADE = 1100; // ms to dry away

interface Spot {
  x: number;
  y: number;
  born: number;
  fadeAt: number | null;
  waves: Array<{ f: number; a: number; p: number; w: number }>;
  specks: Array<{ th: number; d: number; at: number; s: number }>;
}

export const leakRadius = (ms: number) => Math.min(R_MAX, R0 + K * Math.sqrt(Math.max(0, ms)));

function makeSpot(x: number, y: number, now: number): Spot {
  const waves = Array.from({ length: 6 }, (_, k) => ({
    f: 2 + k * 2 + Math.floor(Math.random() * 3),
    a: 0.12 / (k + 1) + Math.random() * 0.05,
    p: Math.random() * Math.PI * 2,
    w: (Math.random() - 0.5) * 0.5, // drift, radians per second
  }));
  // Specks: each wicks out once the spot is big enough to reach it.
  const specks = Array.from({ length: 5 + Math.floor(Math.random() * 5) }, () => ({
    th: Math.random() * Math.PI * 2,
    d: 1.08 + Math.random() * 0.4,
    at: 10 + Math.random() * 45,
    s: 0.05 + Math.random() * 0.08,
  }));
  return { x, y, born: now, fadeAt: null, waves, specks };
}

// The edge of a spot of radius r: rough waves (stronger as it grows) whose
// phases drift with time t (s), so the outline creeps rather than scales.
function outline(s: Spot, r: number, t: number, scale: number): Path2D {
  const rough = Math.min(1, r / 22);
  const path = new Path2D();
  const n = Math.max(40, Math.min(160, Math.round(r * 2)));
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    let k = 1;
    for (const w of s.waves) k += rough * w.a * Math.sin(w.f * th + w.p + w.w * t);
    k += rough * 0.035 * Math.sin(29 * th + s.waves[0].p); // fibres
    const x = s.x + Math.cos(th) * r * k * scale;
    const y = s.y + Math.sin(th) * r * k * scale;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

export function leakPainter(): InkPainter {
  let spots: Spot[] = [];
  let active: Spot | null = null;

  const dry = (now: number) => {
    if (active) active.fadeAt = now;
    active = null;
  };
  const awayFrom = (x: number, y: number, now: number) => {
    if (active && Math.hypot(x - active.x, y - active.y) > AWAY) dry(now);
  };

  return {
    move: (x, y, now) => awayFrom(x, y, now),
    rest(x, y, now) {
      if (active) return; // still there, spreading
      active = makeSpot(x, y, now);
      spots.push(active);
    },
    scroll(dy, pointer, now) {
      for (const s of spots) s.y -= dy;
      if (pointer) awayFrom(pointer.x, pointer.y, now);
    },
    leave: dry,
    draw(ctx, now, ink) {
      spots = spots.filter((s) => s.fadeAt === null || now - s.fadeAt < FADE);
      ctx.filter = 'blur(1.1px)';
      for (const s of spots) {
        const grown = (s.fadeAt ?? now) - s.born;
        // Drying, it still creeps out a touch as the wet front settles.
        const settle = s.fadeAt === null ? 0 : Math.min(1, (now - s.fadeAt) / FADE);
        const r = leakRadius(grown) * (1 + 0.06 * settle);
        const alpha = s.fadeAt === null ? Math.min(1, (now - s.born) / APPEAR) : Math.pow(1 - settle, 1.4);
        if (alpha <= 0) continue;
        const t = grown / 1000;
        // The wet front, pale, just ahead of the pigment.
        ctx.fillStyle = rgba(ink, 0.1 * alpha);
        ctx.fill(outline(s, r, t, 1.16));
        // The pigment: lighter in the middle, darker where it pools at the rim.
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.2);
        g.addColorStop(0, rgba(ink, 0.26 * alpha));
        g.addColorStop(0.6, rgba(ink, 0.3 * alpha));
        g.addColorStop(0.92, rgba(ink, 0.46 * alpha));
        g.addColorStop(1, rgba(ink, 0.5 * alpha));
        ctx.fillStyle = g;
        ctx.fill(outline(s, r, t, 1));
        // Specks out in the fibres.
        ctx.fillStyle = rgba(ink, 0.34 * alpha);
        for (const p of s.specks) {
          if (r < p.at) continue;
          const reach = Math.min(1, (r - p.at) / 12);
          const d = r * p.d;
          ctx.beginPath();
          ctx.arc(s.x + Math.cos(p.th) * d, s.y + Math.sin(p.th) * d, Math.max(0.6, r * p.s * reach), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.filter = 'none';
      // Moving while one is drying, or spreading and not yet full size.
      return spots.some((s) => s.fadeAt !== null || leakRadius(now - s.born) < R_MAX || now - s.born < APPEAR);
    },
  };
}

// ── trail ────────────────────────────────────────────────────────────────

const SPRITE = 96; // px, each splotch's canvas
const STEP = 9; // px of travel between drops
const LIFE = 2400; // ms from landing to dry
const SPREAD = 900; // ms to bleed out to full size
const MAX_DROPS = 260;

interface Drop {
  x: number;
  y: number;
  born: number;
  size: number; // radius at full spread, px
  sprite: number;
  angle: number;
  life: number;
  alpha: number;
}

// A seeded splotch, in black (tinted when drawn): a ragged blob, its rim
// darker than its middle, softened at the edge, with a speck or two.
function makeSprite(seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d')!;
  let s = (seed * 9973 + 7) % 2147483647;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const mid = SPRITE / 2;
  const R = SPRITE * 0.28;
  const waves = Array.from({ length: 5 }, (_, k) => ({
    f: 2 + k * 2 + Math.floor(rnd() * 3),
    a: 0.14 / (k + 1) + rnd() * 0.05,
    p: rnd() * Math.PI * 2,
  }));
  const blob = new Path2D();
  for (let i = 0; i <= 72; i++) {
    const th = (i / 72) * Math.PI * 2;
    let r = 1;
    for (const w of waves) r += w.a * Math.sin(w.f * th + w.p);
    const x = mid + Math.cos(th) * R * r;
    const y = mid + Math.sin(th) * R * r;
    if (i === 0) blob.moveTo(x, y);
    else blob.lineTo(x, y);
  }
  blob.closePath();
  for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
    const th = rnd() * Math.PI * 2;
    const d = R * (1.15 + rnd() * 0.35);
    blob.moveTo(mid + Math.cos(th) * d, mid + Math.sin(th) * d);
    blob.arc(mid + Math.cos(th) * d, mid + Math.sin(th) * d, R * (0.07 + rnd() * 0.12), 0, Math.PI * 2);
  }
  const rim = g.createRadialGradient(mid, mid, 0, mid, mid, R * 1.25);
  rim.addColorStop(0, 'rgba(0,0,0,0.5)');
  rim.addColorStop(0.65, 'rgba(0,0,0,0.62)');
  rim.addColorStop(1, 'rgba(0,0,0,0.95)');
  g.filter = 'blur(1.4px)';
  g.fillStyle = rim;
  g.fill(blob);
  return c;
}

export function trailPainter(): InkPainter {
  let drops: Drop[] = [];
  let sprites: HTMLCanvasElement[] = [];
  let tinted = '';
  let last: { x: number; y: number; t: number } | null = null;
  let travelled = 0;

  const drop = (x: number, y: number, now: number, size: number, life = LIFE, alpha = 0.42) => {
    if (drops.length >= MAX_DROPS) drops.shift();
    drops.push({ x, y, size, life, alpha, born: now, sprite: Math.floor(Math.random() * 6), angle: Math.random() * Math.PI * 2 });
  };

  // The splotches, in the ink's colour (redrawn if it changes).
  function tint(ink: Rgb) {
    const key = ink.join(',');
    if (key === tinted && sprites.length) return;
    tinted = key;
    const base = Math.floor(Math.random() * 1000);
    sprites = Array.from({ length: 6 }, (_, i) => {
      const c = makeSprite(base + i * 31 + 1);
      const g = c.getContext('2d')!;
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = rgba(ink, 1);
      g.fillRect(0, 0, SPRITE, SPRITE);
      return c;
    });
  }

  return {
    move(x, y, now) {
      if (!last) {
        last = { x, y, t: now };
        drop(x, y, now, 4 + Math.random() * 2);
        return;
      }
      const dx = x - last.x;
      const dy = y - last.y;
      const dist = Math.hypot(dx, dy);
      const speed = dist / Math.max(1, now - last.t); // px per ms
      // Slower strokes lay down more ink.
      const big = Math.max(0, 1 - speed / 2.5);
      let along = STEP - travelled;
      while (along <= dist) {
        const f = along / dist;
        drop(last.x + dx * f + (Math.random() - 0.5) * 2, last.y + dy * f + (Math.random() - 0.5) * 2, now, 3.2 + big * 3.2 + Math.random() * 1.6);
        along += STEP * (0.7 + Math.random() * 0.6);
      }
      travelled = Math.max(0, dist - (along - STEP));
      last = { x, y, t: now };
    },
    rest: (x, y, now) => drop(x, y, now, 13 + Math.random() * 4, LIFE * 1.5, 0.36),
    scroll(dy) {
      for (const d of drops) d.y -= dy;
      if (last) last.y -= dy;
    },
    leave() {
      last = null;
      travelled = 0;
    },
    draw(ctx, now, ink) {
      tint(ink);
      drops = drops.filter((d) => now - d.born < d.life);
      for (const d of drops) {
        const age = now - d.born;
        // Bleeds out fast at first, then slowly; dries (fades) late.
        const spread = 1 - Math.pow(1 - Math.min(1, age / SPREAD), 3);
        const r = d.size * (0.45 + 0.55 * spread);
        const t = age / d.life;
        const dry = t < 0.3 ? 1 : 1 - Math.pow((t - 0.3) / 0.7, 1.6);
        const scale = (r * 2) / (SPRITE * 0.56);
        ctx.globalAlpha = d.alpha * dry;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.angle);
        ctx.scale(scale, scale);
        ctx.drawImage(sprites[d.sprite], -SPRITE / 2, -SPRITE / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      return drops.length > 0;
    },
  };
}

// ── pen ──────────────────────────────────────────────────────────────────

const PEN_LIFE = 2200; // ms for the line to dry away
const PEN_MAX = 400; // points kept

interface PenPoint {
  x: number;
  y: number;
  t: number;
  w: number; // line width here, px
  gap: boolean; // starts a new stroke (after leaving the window)
}

export function penPainter(): InkPainter {
  let pts: PenPoint[] = [];
  let last: PenPoint | null = null;
  let gap = true;

  return {
    move(x, y, now) {
      // Thicker where the hand is slow, as a nib lays down more ink.
      const speed = last && !gap ? Math.hypot(x - last.x, y - last.y) / Math.max(1, now - last.t) : 0;
      const w = 1.5 + 2.4 * Math.max(0, 1 - speed / 1.8);
      const p = { x, y, t: now, w: last && !gap ? last.w * 0.6 + w * 0.4 : w, gap };
      gap = false;
      pts.push(p);
      if (pts.length > PEN_MAX) pts.shift();
      last = p;
    },
    // Resting, the nib leaves a little pool.
    rest(x, y, now) {
      const p = { x, y, t: now, w: 5, gap: false };
      pts.push(p);
      last = p;
    },
    scroll(dy) {
      for (const p of pts) p.y -= dy;
    },
    leave() {
      gap = true;
    },
    draw(ctx, now, ink) {
      pts = pts.filter((p) => now - p.t < PEN_LIFE);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Two passes: a wide pale feather where the ink has wicked into the
      // paper, then the line itself.
      for (const pass of [0, 1]) {
        ctx.filter = pass === 0 ? 'blur(2px)' : 'blur(0.4px)';
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          if (b.gap) continue;
          const life = 1 - (now - a.t) / PEN_LIFE;
          if (life <= 0) continue;
          const dry = Math.pow(life, 1.3);
          ctx.strokeStyle = rgba(ink, (pass === 0 ? 0.16 : 0.6) * dry);
          // Drying, the line thins and the feather spreads.
          ctx.lineWidth = pass === 0 ? b.w * (2.6 + (1 - life) * 1.5) : b.w * (0.55 + 0.45 * life);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        // The pools left by rests.
        for (const p of pts) {
          if (p.w < 5) continue;
          const life = 1 - (now - p.t) / PEN_LIFE;
          ctx.fillStyle = rgba(ink, (pass === 0 ? 0.14 : 0.4) * Math.pow(life, 1.3));
          ctx.beginPath();
          ctx.arc(p.x, p.y, pass === 0 ? 6 + (1 - life) * 3 : 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.filter = 'none';
      return pts.length > 0;
    },
  };
}

export function inkPainter(style: CursorInkStyle): InkPainter | null {
  if (style === 'leak') return leakPainter();
  if (style === 'trail') return trailPainter();
  if (style === 'pen') return penPainter();
  return null;
}
