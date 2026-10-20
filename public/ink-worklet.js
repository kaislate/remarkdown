// The ink-drying mask for switching in and out of reader mode
// (lib/ink-transition.ts, styles/ink-transition.css). Drawn every frame
// from --ink-t (0 → 1): the old view starts whole, and blots — each a few
// soft-edged lobes, so no outline is round — open up in it at their own
// moments, growing until they run together; at the end what's left fades
// evenly, so nothing pops. --ink-seed picks the blots, so each switch dries
// differently. Opaque = the old view still shows.

// Tuned (by simulating how much of the old view is left over --ink-t) so
// it dries away about evenly from start to finish.
const BLOTS = 80;
const LOBES = 6;

registerPaint(
  'ink-dry',
  class {
    static get inputProperties() {
      return ['--ink-t', '--ink-seed'];
    }

    paint(ctx, size, props) {
      const t = parseFloat(String(props.get('--ink-t'))) || 0;
      const seed = parseFloat(String(props.get('--ink-seed'))) || 1;
      const w = size.width;
      const h = size.height;
      if (t >= 1) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      if (t <= 0) return;

      // A small seeded generator, so the blots stay put from frame to frame.
      let s = Math.floor(seed * 7919) % 233280;
      const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;

      ctx.globalCompositeOperation = 'destination-out';
      const unit = Math.max(w, h);
      for (let i = 0; i < BLOTS; i++) {
        const cx = rnd() * w;
        const cy = rnd() * h;
        const base = unit * (0.03 + rnd() * rnd() * 0.09);
        const start = rnd() * 0.8;
        const lobes = [];
        for (let k = 0; k < LOBES; k++) lobes.push([rnd() * Math.PI * 2, rnd() * 0.8, 0.3 + rnd() * 0.7]);
        const p = Math.min(1, Math.max(0, (t - start) / (1 - start)));
        if (p <= 0) continue;
        const grow = 1 - Math.pow(1 - p, 2.2);
        const r = base * (0.15 + grow * 1.5);
        for (const [ang, dist, f] of lobes) {
          const x = cx + Math.cos(ang) * dist * r;
          const y = cy + Math.sin(ang) * dist * r;
          const lr = r * f;
          const g = ctx.createRadialGradient(x, y, lr * 0.7, x, y, lr);
          g.addColorStop(0, 'rgba(0,0,0,1)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, lr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // The last of it dries evenly.
      if (t > 0.86) {
        ctx.fillStyle = `rgba(0,0,0,${Math.min(1, (t - 0.86) / 0.14)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
  },
);
