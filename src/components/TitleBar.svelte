<script lang="ts">
  // Custom title bar for a frameless Tauri window.
  //
  // Rendered as two independent fixed elements so they don't fight the other
  // chrome (the hamburger on the left, the minimap on the right):
  //   - .titlebar-drag sits in the top-middle band at z-index 50, below the
  //     hamburger (z:100) so menu clicks aren't intercepted.
  //   - .titlebar-controls is a glass pill at top-right at z-index 180, above
  //     the minimap (z:60) so the buttons stay visible and clickable.
  //
  // Drag-to-move uses getCurrentWindow().startDragging() on pointerdown — more
  // reliable in Tauri 2 than relying on the data-tauri-drag-region attribute.
  import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

  // Default startup window size, mirrored from src-tauri/tauri.conf.json.
  // Double-clicking the resize grip restores the window to this size.
  const DEFAULT_WIDTH = 1100;
  const DEFAULT_HEIGHT = 780;

  async function safeCall(fn: () => Promise<unknown>) {
    try { await fn(); } catch { /* outside Tauri */ }
  }

  // Movement threshold (in CSS pixels, squared for distance compare) before
  // a pointerdown is treated as the start of a drag. Calling
  // startDragging/startResizeDragging on the first pointerdown hands input
  // over to the OS and consumes the click sequence that the browser needs
  // to fire 'dblclick'. By waiting for actual movement we keep dblclick
  // working for taps that release without moving.
  const DRAG_THRESHOLD_SQ = 4 * 4;

  // Generic "click-or-drag" handler: arms on pointerdown, fires `start` once
  // the pointer travels past the threshold. If the pointer is released
  // before crossing the threshold the browser sees a normal click and
  // dblclick still fires as expected.
  function armClickOrDrag(e: PointerEvent, start: () => Promise<unknown> | unknown) {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement | null;
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let armed = true;

    const onMove = (m: PointerEvent) => {
      if (!armed) return;
      const dx = m.clientX - startX;
      const dy = m.clientY - startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;
      armed = false;
      cleanup();
      void Promise.resolve().then(start).catch(() => { /* outside Tauri */ });
    };
    const onUp = () => {
      armed = false;
      cleanup();
    };
    const cleanup = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      if (target.hasPointerCapture?.(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    };

    try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  function onDragPointerDown(e: PointerEvent) {
    armClickOrDrag(e, () => getCurrentWindow().startDragging());
  }

  function onTitleBarDoubleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    void safeCall(() => getCurrentWindow().toggleMaximize());
  }

  function onResizePointerDown(e: PointerEvent) {
    armClickOrDrag(e, () => getCurrentWindow().startResizeDragging('SouthEast'));
  }

  async function onResizeDoubleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await safeCall(() =>
      getCurrentWindow().setSize(new LogicalSize(DEFAULT_WIDTH, DEFAULT_HEIGHT)),
    );
  }

  const minimize = () => safeCall(() => getCurrentWindow().minimize());
  const toggleMaximize = () => safeCall(() => getCurrentWindow().toggleMaximize());
  const close = () => safeCall(() => getCurrentWindow().close());
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="titlebar-drag"
  data-tauri-drag-region
  onpointerdown={onDragPointerDown}
  ondblclick={onTitleBarDoubleClick}
  role="presentation"
></div>

<!-- Subtle animated aura behind the controls. Non-interactive — just a
     visual anchor that delineates where the buttons are without framing
     them in a hard panel. -->
<div class="controls-aura" aria-hidden="true"></div>

<div class="titlebar-controls">
  <button
    class="ctrl min"
    aria-label="Minimize"
    title="Minimize"
    onclick={minimize}
  >
    <span aria-hidden="true">&#x2500;</span>
  </button>
  <button
    class="ctrl max"
    aria-label="Maximize"
    title="Maximize"
    onclick={toggleMaximize}
  >
    <span aria-hidden="true">&#x25A1;</span>
  </button>
  <button
    class="ctrl close"
    aria-label="Close"
    title="Close"
    onclick={close}
  >
    <span aria-hidden="true">&#x00D7;</span>
  </button>
</div>

<!-- Bottom-right resize grip. The container is a generous 36×36 hit
     zone (so the user doesn't have to land on a tiny target) but the
     visible glyph stays as three short diagonal strokes anchored in
     the lower-right 16px. pointerdown delegates to the OS via Tauri's
     startResizeDragging so the user gets a native resize feel. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="resize-grip"
  role="presentation"
  aria-hidden="true"
  title="Drag to resize • double-click to reset"
  onpointerdown={onResizePointerDown}
  ondblclick={onResizeDoubleClick}
>
  <svg viewBox="0 0 16 16" aria-hidden="true" class="grip-glyph">
    <line x1="15" y1="3"  x2="3"  y2="15" />
    <line x1="15" y1="7"  x2="7"  y2="15" />
    <line x1="15" y1="11" x2="11" y2="15" />
  </svg>
</div>

<style>
  .titlebar-drag {
    position: fixed;
    top: 0;
    left: 62px;    /* clear the hamburger (14 + 38 + gap) */
    right: 168px;  /* clear the controls area */
    height: 38px;
    z-index: 50;   /* below the hamburger (100) */
    background: transparent;
  }

  /* The aura is a soft conical gradient that slowly sweeps across the
     top-right corner. Behind the controls (z:170) but above the minimap
     (z:60), so it reads as "here are the window controls" without being
     a hard-edged pill. */
  .controls-aura {
    position: fixed;
    top: -40px;
    right: -40px;
    width: 240px;
    height: 140px;
    pointer-events: none;
    z-index: 170;
    background:
      radial-gradient(
        ellipse 70% 60% at 75% 35%,
        rgba(139, 127, 255, 0.10) 0%,
        rgba(139, 127, 255, 0.05) 35%,
        rgba(139, 127, 255, 0) 70%
      );
    filter: blur(6px);
    animation: swoop 9s ease-in-out infinite;
    transform-origin: 70% 30%;
  }
  @keyframes swoop {
    0%   { transform: translate(0, 0) scale(1);        opacity: 0.85; }
    50%  { transform: translate(-12px, 4px) scale(1.08); opacity: 1;   }
    100% { transform: translate(0, 0) scale(1);        opacity: 0.85; }
  }

  .titlebar-controls {
    position: fixed;
    top: 0;
    right: 0;
    display: flex;
    align-items: stretch;
    height: 38px;
    z-index: 180;
    /* No pill — bare buttons over the aura and the canvas. */
    background: transparent;
    border: 0;
  }
  /* Title-bar window controls — bare buttons that bloom on hover.
     Each carries a --ctrl-color custom property; ::before is a
     glowing orb that scales up behind the icon, ::after is a ripple
     ring that expands outward, and the icon itself does a small
     action-specific transform. No flat squares, no harsh red
     rectangle on close. */
  .ctrl {
    position: relative;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    width: 44px;
    height: 38px;
    cursor: pointer;
    display: grid;
    place-items: center;
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1;
    padding: 0;
    transition: color 0.18s ease;
  }
  .ctrl > :global(span) {
    position: relative;
    z-index: 2;
    display: inline-block;
    transition:
      transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1),
      text-shadow 0.18s ease;
  }
  /* Glowing orb behind the icon — radial gradient + soft halo */
  .ctrl::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    transform: translate(-50%, -50%) scale(0);
    opacity: 0;
    pointer-events: none;
    background: radial-gradient(
      circle at 35% 30%,
      rgba(255, 255, 255, 0.55) 0%,
      var(--ctrl-color, var(--accent)) 48%,
      rgba(0, 0, 0, 0) 100%
    );
    box-shadow:
      0 0 14px var(--ctrl-color, var(--accent)),
      0 0 28px color-mix(in srgb, var(--ctrl-color, var(--accent)) 50%, transparent);
    filter: blur(0.4px);
    transition:
      transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1),
      opacity 0.22s ease;
    z-index: 1;
  }
  /* Outer ripple ring — appears slightly after the orb for a
     "echoing pulse" feel */
  .ctrl::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    border: 1px solid var(--ctrl-color, var(--accent));
    transform: translate(-50%, -50%) scale(0.4);
    opacity: 0;
    pointer-events: none;
    transition:
      transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.05s,
      opacity 0.32s ease;
    z-index: 1;
  }

  .ctrl:hover {
    color: #fff;
  }
  .ctrl:hover::before {
    transform: translate(-50%, -50%) scale(3.4);
    opacity: 0.95;
  }
  .ctrl:hover::after {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.45;
  }

  /* Action-coded color + per-icon micro animation */
  .ctrl.min {
    --ctrl-color: #f5b54a;     /* warm amber — 'set aside' */
  }
  .ctrl.min:hover > :global(span) {
    transform: translateY(4px);
  }

  .ctrl.max {
    --ctrl-color: #5dd0d6;     /* cool cyan — 'expand' */
  }
  .ctrl.max:hover > :global(span) {
    transform: scale(1.25);
  }

  .ctrl.close {
    --ctrl-color: #ff5e6e;     /* vivid red — 'dismiss' */
  }
  .ctrl.close:hover > :global(span) {
    transform: rotate(90deg) scale(1.15);
    text-shadow: 0 0 10px rgba(255, 94, 110, 0.85);
  }

  @media (prefers-reduced-motion: reduce) {
    .ctrl::before,
    .ctrl::after,
    .ctrl > :global(span) {
      transition-duration: 0.1s;
    }
  }

  /* Resize grip — generous 36×36 hit zone in the bottom-right corner so
     the user doesn't have to be precise. The glyph (three diagonals)
     stays small (16×16) and anchored bottom-right; the rest of the box
     is invisible-but-grabbable. user-select:none + a transparent
     background block text selection from starting under the grip
     before startResizeDragging takes over at the OS level. z-index
     sits above minimap (60) but below modals. */
  .resize-grip {
    position: fixed;
    right: 0;
    bottom: 0;
    width: 36px;
    height: 36px;
    z-index: 70;
    cursor: nwse-resize;
    color: var(--fg-2);
    transition: color 0.15s ease;
    /* A transparent (but non-empty) background ensures the div is the
       hit-target across its whole bounding box, not just where the SVG
       paints. Without this, a click between strokes would fall through
       to text below and start a selection. */
    background: rgba(0, 0, 0, 0);
    user-select: none;
    -webkit-user-select: none;
    /* Touch action: none stops the browser from scrolling/zooming on
       touch drags so the resize gesture wins. */
    touch-action: none;
  }
  .resize-grip:hover {
    color: var(--accent);
  }
  .grip-glyph {
    /* The glyph is a 16×16 indicator pinned to the bottom-right corner
       of the 36×36 hit zone. pointer-events:none hands all events to
       the parent div so there are no gaps in the hit area. */
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 16px;
    height: 16px;
    display: block;
    pointer-events: none;
    opacity: 0.55;
    transition: opacity 0.15s ease;
  }
  .resize-grip:hover .grip-glyph {
    opacity: 1;
  }
  .grip-glyph line {
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
</style>
