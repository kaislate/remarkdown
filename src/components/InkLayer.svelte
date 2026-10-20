<script lang="ts">
  // The ink trail from the contents to a heading (lib/section-jump.ts).
  // Flat ink in the accent colour, made goopy by a "goo" filter: blurred
  // drops pushed back to hard edges merge wherever they touch, so a head
  // drop and the drops trailing it stretch into one stream.
  //
  //   swell  — a drop wells up on the contents' marker;
  //   run    — it pours along a curve to the heading (followed live while
  //            the page glides), the marker's drop draining as it goes;
  //   land   — it spreads into a stroke under the heading;
  //   fade   — and the ink dries away.
  import { onDestroy } from 'svelte';
  import { inkTrail, type InkTrail } from '../lib/section-jump';

  const SWELL_MS = 140;
  const LAND_MS = 300;
  const HOLD_MS = 380;
  const FADE_MS = 460;
  // Drops following the head, close enough that the goo joins them into
  // one stream that tapers off behind it.
  const TRAIL = 14;
  const TRAIL_LAG = 0.034;
  const HEAD_R = 7;
  const SOURCE_R = 9;

  interface Drop { x: number; y: number; r: number }

  let drops = $state<Drop[]>([]);
  let source = $state<Drop | null>(null);
  let stroke = $state<{ x: number; y: number; w: number } | null>(null);
  let opacity = $state(1);
  let frame = 0;

  const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
  const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

  function bezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const m = 1 - t;
    return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3;
  }

  // Where the heading is now: the ink aims just left of it, and lands as a
  // stroke under its text (as wide as the words, not the whole column).
  function aim(target: HTMLElement) {
    const r = target.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(target);
    const text = range.getBoundingClientRect();
    const width = Math.min(text.width || r.width, r.width);
    const h = window.innerHeight;
    const y = Math.min(h - 16, Math.max(16, r.top + r.height / 2));
    return {
      x: r.left - 12,
      y,
      lineX: r.left,
      lineY: Math.min(h - 8, Math.max(8, r.bottom + 4)),
      lineW: Math.max(24, width),
    };
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    drops = [];
    source = null;
    stroke = null;
  }

  function run(trail: InkTrail) {
    stop();
    opacity = 1;
    const t0 = performance.now();
    const S = trail.from;
    const travelEnd = SWELL_MS + trail.travel;
    const total = travelEnd + LAND_MS + HOLD_MS + FADE_MS;

    const tick = () => {
      const t = performance.now() - t0;
      if (t >= total || !trail.target.isConnected) { stop(); return; }
      const E = aim(trail.target);
      // A gentle S-curve: out of the contents sideways, into the heading
      // from its left.
      const c1x = S.x + Math.max(48, (E.x - S.x) * 0.45);
      const c2x = E.x - Math.max(36, Math.abs(E.x - S.x) * 0.25);
      const at = (p: number): { x: number; y: number } => ({
        x: bezier(S.x, c1x, c2x, E.x, p),
        y: bezier(S.y, S.y, E.y, E.y, p),
      });

      // The marker's drop: wells up, then drains as the ink pours out.
      const swell = easeOut(clamp01(t / SWELL_MS));
      const run = clamp01((t - SWELL_MS) / trail.travel);
      source = { x: S.x, y: S.y, r: SOURCE_R * swell * Math.pow(1 - run, 0.6) };

      const land = clamp01((t - travelEnd) / LAND_MS);
      const next: Drop[] = [];
      if (t >= SWELL_MS) {
        for (let k = 0; k <= TRAIL; k++) {
          const p = easeInOut(clamp01(run - k * TRAIL_LAG));
          if (p <= 0 && k > 0) continue;
          let { x, y } = at(p);
          // Landing: everything flows into the start of the stroke.
          if (land > 0) {
            const l = easeOut(land);
            x += (E.lineX + 6 - x) * l;
            y += (E.lineY - y) * l;
          }
          const r = (HEAD_R - k * 0.36) * (1 - easeOut(land) * 0.7);
          if (r > 0.5) next.push({ x, y, r });
        }
      }
      drops = next;
      stroke = land > 0 ? { x: E.lineX, y: E.lineY, w: E.lineW * easeOut(land) } : null;
      opacity = 1 - clamp01((t - travelEnd - LAND_MS - HOLD_MS) / FADE_MS);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  const unsub = inkTrail.subscribe((trail) => {
    if (trail) run(trail);
  });
  onDestroy(() => {
    unsub();
    stop();
  });
</script>

{#if source || drops.length || stroke}
  <svg class="ink-layer" aria-hidden="true" style:opacity>
    <defs>
      <filter id="ink-goo" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
        <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
      </filter>
    </defs>
    <g class="ink" filter="url(#ink-goo)">
      {#if source && source.r > 0.3}<circle cx={source.x} cy={source.y} r={source.r} />{/if}
      {#each drops as d, i (i)}<circle cx={d.x} cy={d.y} r={d.r} />{/each}
      {#if stroke}<rect x={stroke.x} y={stroke.y - 4} width={stroke.w} height="8" rx="4" />{/if}
    </g>
  </svg>
{/if}

<style>
  /* Over the page and the contents (so the ink can leave the popover),
     under dialogs. Never takes the pointer. */
  .ink-layer {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    z-index: 120;
    pointer-events: none;
    overflow: visible;
  }
  .ink {
    fill: var(--accent);
  }
</style>
