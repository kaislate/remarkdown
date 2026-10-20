<script lang="ts">
  // Ink from the pointer in reader mode, in the style chosen in Settings
  // (lib/cursor-ink.ts draws it). This hosts it: a canvas over the page
  // that never takes a click, the pointer (and when it comes to rest),
  // page scrolls (the ink is in the paper, so it moves with the page), the
  // ink's colour, and a frame loop that runs only while ink is moving.
  // Mounted by App.svelte while reading with a style chosen; nothing is
  // drawn under reduced motion, on the e-ink theme, or for touch.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { settings } from '../stores/settings';
  import { readerThemeTone } from '../lib/reader-themes';
  import { inkPainter, REST_MS, type CursorInkStyle, type InkPainter, type Rgb } from '../lib/cursor-ink';

  let { style }: { style: CursorInkStyle } = $props();

  let canvas: HTMLCanvasElement;
  let painter: InkPainter | null = null;
  let run = () => {};

  // A new style starts with a clean page.
  $effect(() => {
    painter = inkPainter(style);
    run();
  });

  onMount(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let pointer: { x: number; y: number } | null = null;
    let restTimer: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;
    let dpr = 1;
    let ink: Rgb = [60, 60, 60];
    const scrollTops = new WeakMap<EventTarget, number>();

    function size() {
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      run();
    }

    // Grey ink: the page's own text colour, laid down thin. On light pages
    // it multiplies into the paper (and the text) like real ink.
    function takeColours() {
      const page = document.querySelector('.viewer') ?? document.body;
      const m = getComputedStyle(page).color.match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3) ink = [Number(m[0]), Number(m[1]), Number(m[2])];
      const appTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      canvas.style.mixBlendMode = readerThemeTone(get(settings).readerTheme, appTheme) === 'light' ? 'multiply' : 'normal';
    }

    function allowed(): boolean {
      if (get(settings).readerTheme === 'eink') return false;
      return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true;
    }

    function draw(now: number) {
      frame = 0;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (painter?.draw(ctx!, now, ink)) frame = requestAnimationFrame(draw);
    }
    run = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    size();

    function waitForRest() {
      if (restTimer) clearTimeout(restTimer);
      restTimer = setTimeout(() => {
        restTimer = null;
        if (!pointer || !allowed()) return;
        takeColours(); // the reader theme may have changed
        painter?.rest(pointer.x, pointer.y, performance.now());
        run();
      }, REST_MS);
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType === 'touch' || !allowed()) return;
      if (!pointer) takeColours();
      pointer = { x: e.clientX, y: e.clientY };
      painter?.move(pointer.x, pointer.y, performance.now());
      waitForRest();
      run();
    }

    function onScroll(e: Event) {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el || !el.classList.contains('scroll')) return;
      const dy = el.scrollTop - (scrollTops.get(el) ?? el.scrollTop);
      scrollTops.set(el, el.scrollTop);
      if (!dy) return;
      painter?.scroll(dy, pointer, performance.now());
      if (pointer) waitForRest();
      run();
    }
    // Where each page starts, so the first scroll moves the ink by the right amount.
    for (const el of document.querySelectorAll<HTMLElement>('.scroll')) scrollTops.set(el, el.scrollTop);

    function onLeave() {
      pointer = null;
      if (restTimer) clearTimeout(restTimer);
      restTimer = null;
      painter?.leave(performance.now());
      run();
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    window.addEventListener('resize', size);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (restTimer) clearTimeout(restTimer);
      run = () => {};
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll, { capture: true });
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
