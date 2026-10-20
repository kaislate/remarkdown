// The ink-drying mask for switching in and out of reader mode
// (lib/ink-transition.ts, styles/ink-transition.css), drawn every frame
// from --ink-t (0 → 1). Opaque = the old view still shows.
//
// The shape is ink soaking into paper: a "soak map" — how soon each spot
// of the page is reached — made once per switch from a dozen soak points
// (each starting at its own moment) whose spread is roughened by warped
// fractal noise, so the fronts finger out ragged and branching instead of
// round. Each frame only traces where the map is below the current level
// (marching squares, edges interpolated) and cuts that out of the old view
// with a slightly feathered edge. The level is the map's own t-quantile,
// so exactly that share of the old view has gone at every moment: it dries
// away evenly. --ink-seed picks the pattern, so each switch is different.

const CELLS = 150; // grid cells across the longer side
const SOAK_POINTS = 24;
const cache = new Map();

// Integer hash → 0..1 (fast; the map is built from ~100k of these).
function hash(i, j, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j, seed);
  const b = hash(i + 1, j, seed);
  const c = hash(i, j + 1, seed);
  const d = hash(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal (fBm) noise in 0..1.
function fbm(x, y, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x, y, seed + o * 131);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

// The soak map for this seed and grid, and its sorted values. Built once
// per seed — ahead of time, by lib/ink-transition.ts painting a small
// hidden element with the next switch's seed, so the switch itself never
// waits for it.
function soakMap(seed, gw, gh, aspect) {
  const key = `${seed}|${gw}x${gh}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let s = Math.floor(seed * 7919) % 233280;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const points = [];
  for (let k = 0; k < SOAK_POINTS; k++) {
    points.push({ x: rnd() * aspect, y: rnd(), start: rnd() * 0.75, speed: 0.45 + rnd() * 0.9 });
  }
  const map = new Float32Array((gw + 1) * (gh + 1));
  for (let j = 0; j <= gh; j++) {
    for (let i = 0; i <= gw; i++) {
      // Page coordinates: y in 0..1, x in 0..aspect.
      let x = (i / gw) * aspect;
      let y = j / gh;
      // Warp the page by noise, so the fronts finger and branch.
      const wx = fbm(x * 3 + 3.1, y * 3 + 7.7, seed * 7 + 101) - 0.5;
      const wy = fbm(x * 3 + 9.4, y * 3 + 1.3, seed * 7 + 211) - 0.5;
      x += wx * 0.7;
      y += wy * 0.7;
      let reach = Infinity;
      for (const p of points) {
        const d = Math.hypot(x - p.x, y - p.y);
        reach = Math.min(reach, p.start + d / p.speed);
      }
      // Fibres: fine fractal roughness on the front.
      reach += (fbm(x * 5, y * 5, seed * 7 + 307) - 0.5) * 0.16 + (fbm(x * 15, y * 15, seed * 7 + 401) - 0.5) * 0.14;
      map[j * (gw + 1) + i] = reach;
    }
  }
  const sorted = Float32Array.from(map).sort();
  const entry = { map, sorted };
  if (cache.size > 6) cache.clear();
  cache.set(key, entry);
  return entry;
}

registerPaint(
  'ink-dry',
  class {
    static get inputProperties() {
      return ['--ink-t', '--ink-seed'];
    }

    paint(ctx, size, props) {
      const t = parseFloat(String(props.get('--ink-t'))) || 0;
      const seed = Math.round(parseFloat(String(props.get('--ink-seed'))) || 1);
      const w = size.width;
      const h = size.height;
      if (t >= 1) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      if (t <= 0 || w === 0 || h === 0) return;

      const long = Math.max(w, h);
      const cell = long / CELLS;
      const gw = Math.ceil(w / cell);
      const gh = Math.ceil(h / cell);
      const { map, sorted } = soakMap(seed, gw, gh, gw / gh);
      const level = sorted[Math.min(sorted.length - 1, Math.floor(t * sorted.length))];
      const at = (i, j) => map[j * (gw + 1) + i];
      // Where the front crosses the edge between two grid points.
      const cross = (a, b) => (level - a) / (b - a);

      const path = new Path2D();
      for (let j = 0; j < gh; j++) {
        let run = -1; // start of a run of wholly soaked cells
        for (let i = 0; i <= gw; i++) {
          const inside = i < gw;
          const a = inside ? at(i, j) : 0;
          const b = inside ? at(i + 1, j) : 0;
          const c = inside ? at(i + 1, j + 1) : 0;
          const d = inside ? at(i, j + 1) : 0;
          const full = inside && a < level && b < level && c < level && d < level;
          if (full) {
            if (run < 0) run = i;
            continue;
          }
          if (run >= 0) {
            path.rect(run * cell, j * cell, (i - run) * cell + 0.6, cell + 0.6);
            run = -1;
          }
          if (!inside) break;
          const any = a < level || b < level || c < level || d < level;
          if (!any) continue;
          // Marching squares: the soaked part of this cell as a polygon,
          // walking its corners and edge crossings in order.
          const x0 = i * cell;
          const y0 = j * cell;
          const corners = [
            [x0, y0, a], [x0 + cell, y0, b], [x0 + cell, y0 + cell, c], [x0, y0 + cell, d],
          ];
          const pts = [];
          for (let k = 0; k < 4; k++) {
            const [px, py, pv] = corners[k];
            const [qx, qy, qv] = corners[(k + 1) % 4];
            if (pv < level) pts.push([px, py]);
            if ((pv < level) !== (qv < level)) {
              const f = cross(pv, qv);
              pts.push([px + (qx - px) * f, py + (qy - py) * f]);
            }
          }
          if (pts.length < 3) continue;
          path.moveTo(pts[0][0], pts[0][1]);
          for (let k = 1; k < pts.length; k++) path.lineTo(pts[k][0], pts[k][1]);
          path.closePath();
        }
      }
      // Cut the soaked part out of the old view, with a feathered edge.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = cell * 2.2;
      ctx.fill(path);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 0.8;
      ctx.lineJoin = 'round';
      ctx.stroke(path); // closes hairline seams between cells
    }
  },
);
