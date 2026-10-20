<script lang="ts">
  // In reader mode the mouse leaves a faint trail of grey ink: small drops
  // that bleed outward into the paper and dry away over a couple of
  // seconds; resting the pointer lets a larger blot soak in. Drawn on a
  // canvas over the page (it never takes a click). Each drop is one of a
  // few pre-drawn splotches — ragged edges, a darker rim where ink pools as
  // it dries, a speck or two thrown off — scaled up as it spreads and faded
  // as it dries. The frame loop runs only while drops are still drying.
  // Mounted by App.svelte while reading with the setting on; skipped under
  // reduced motion, on the e-ink theme, and for touch.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { settings } from '../stores/settings';
  import { readerThemeTone } from '../lib/reader-themes';

  const SPRITE = 96; // px, each splotch's canvas
  const SPRITES = 6;
  const STEP = 9; // px of travel between drops
  const LIFE = 2400; // ms from landing to dry
  const SPREAD = 900; // ms to bleed out to full size
  const REST = 380; // ms still before a blot soaks in
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

  let canvas: HTMLCanvasElement;

  // A seeded splotch: a ragged blob (radius roughened by a few sine waves
  // with random phases), its rim darker than its middle, softened at the
  // edge, with a speck or two beside it.
  function makeSprite(seed: number, colour: string): HTMLCanvasElement {
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
    g.filter = 'none';
    // Colour it, keeping the shape's alpha.
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = colour;
    g.fillRect(0, 0, SPRITE, SPRITE);
    return c;
  }

  onMount(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const drops: Drop[] = [];
    let sprites: HTMLCanvasElement[] = [];
    let spriteColour = '';
    let frame = 0;
    let last: { x: number; y: number; t: number } | null = null;
    let travelled = 0;
    let restTimer: ReturnType<typeof setTimeout> | null = null;
    let dpr = 1;

    function size() {
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    }
    size();

    // Grey ink: the page's own text colour, laid down thin. On light pages
    // it multiplies into the paper (and the text) like real ink.
    function inkColour(): string {
      const page = document.querySelector('.viewer') ?? document.body;
      return getComputedStyle(page).color || '#444';
    }
    function ensureSprites() {
      const colour = inkColour();
      if (colour === spriteColour && sprites.length) return;
      spriteColour = colour;
      const base = Math.floor(Math.random() * 1000);
      sprites = Array.from({ length: SPRITES }, (_, i) => makeSprite(base + i * 31 + 1, colour));
      const s = get(settings);
      const appTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      canvas.style.mixBlendMode = readerThemeTone(s.readerTheme, appTheme) === 'light' ? 'multiply' : 'normal';
    }

    function allowed(): boolean {
      if (get(settings).readerTheme === 'eink') return false;
      return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true;
    }

    function drop(x: number, y: number, size: number, life = LIFE, alpha = 0.42) {
      if (drops.length >= MAX_DROPS) drops.shift();
      drops.push({
        x, y, size, life, alpha,
        born: performance.now(),
        sprite: Math.floor(Math.random() * sprites.length),
        angle: Math.random() * Math.PI * 2,
      });
      if (!frame) frame = requestAnimationFrame(draw);
    }

    function draw(now: number) {
      frame = 0;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      let alive = 0;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        const age = now - d.born;
        if (age >= d.life) continue;
        drops[alive++] = d;
        // Bleeds out fast at first, then slowly; dries (fades) late.
        const spread = 1 - Math.pow(1 - Math.min(1, age / SPREAD), 3);
        const r = d.size * (0.45 + 0.55 * spread);
        const t = age / d.life;
        const dry = t < 0.3 ? 1 : 1 - Math.pow((t - 0.3) / 0.7, 1.6);
        const scale = (r * 2) / (SPRITE * 0.56);
        ctx!.globalAlpha = d.alpha * dry;
        ctx!.save();
        ctx!.translate(d.x, d.y);
        ctx!.rotate(d.angle);
        ctx!.scale(scale, scale);
        ctx!.drawImage(sprites[d.sprite], -SPRITE / 2, -SPRITE / 2);
        ctx!.restore();
      }
      drops.length = alive;
      ctx!.globalAlpha = 1;
      if (alive) frame = requestAnimationFrame(draw);
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType === 'touch' || !allowed()) return;
      ensureSprites();
      const now = performance.now();
      if (restTimer) clearTimeout(restTimer);
      const x = e.clientX;
      const y = e.clientY;
      restTimer = setTimeout(() => drop(x, y, 13 + Math.random() * 4, LIFE * 1.5, 0.36), REST);
      if (!last) {
        last = { x, y, t: now };
        drop(x, y, 4 + Math.random() * 2);
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
        drop(last.x + dx * f + (Math.random() - 0.5) * 2, last.y + dy * f + (Math.random() - 0.5) * 2, 3.2 + big * 3.2 + Math.random() * 1.6);
        along += STEP * (0.7 + Math.random() * 0.6);
      }
      travelled = dist - (along - STEP);
      if (travelled < 0) travelled = 0;
      last = { x, y, t: now };
    }

    function onLeave() {
      last = null;
      travelled = 0;
      if (restTimer) clearTimeout(restTimer);
      restTimer = null;
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    window.addEventListener('resize', size);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (restTimer) clearTimeout(restTimer);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('resize', size);
    };
  });
</script>

<canvas class="cursor-ink" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .cursor-ink {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    /* Over the page, under the reader's contents, line and minimap. */
    z-index: 50;
  }
</style>
