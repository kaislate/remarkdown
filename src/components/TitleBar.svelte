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
  import { onMount } from 'svelte';
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

  // Maximize turns into Restore (two overlapping squares) while the window
  // is maximized — Windows' own convention. Tracked from the window itself
  // so double-click-to-maximize, Win+Up and snapping keep it in sync.
  let maximized = $state(false);
  async function syncMaximized() {
    try { maximized = await getCurrentWindow().isMaximized(); } catch { /* outside Tauri */ }
  }
  onMount(() => {
    void syncMaximized();
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      try {
        const un = await getCurrentWindow().onResized(() => { void syncMaximized(); });
        if (disposed) un(); else unlisten = un;
      } catch { /* outside Tauri */ }
    })();
    return () => { disposed = true; unlisten?.(); };
  });

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
  <!-- 10x10 icons on the pixel grid (Windows' caption-button shapes),
       centred in each button so the hover glow sits right behind them. -->
  <button class="ctrl min" aria-label="Minimize" title="Minimize" onclick={minimize}>
    <svg class="icon" viewBox="0 0 10 10" aria-hidden="true" data-icon="minimize">
      <path d="M0 5.5h10" />
    </svg>
  </button>
  <button
    class="ctrl max"
    aria-label={maximized ? 'Restore' : 'Maximize'}
    title={maximized ? 'Restore' : 'Maximize'}
    onclick={toggleMaximize}
  >
    {#if maximized}
      <svg class="icon" viewBox="0 0 10 10" aria-hidden="true" data-icon="restore">
        <path d="M2.5 2.5V.5h7v7h-2" />
        <rect x=".5" y="2.5" width="7" height="7" />
      </svg>
    {:else}
      <svg class="icon" viewBox="0 0 10 10" aria-hidden="true" data-icon="maximize">
        <rect x=".5" y=".5" width="9" height="9" />
      </svg>
    {/if}
  </button>
  <button class="ctrl close" aria-label="Close" title="Close" onclick={close}>
    <svg class="icon" viewBox="0 0 10 10" aria-hidden="true" data-icon="close">
      <path d="M.5.5l9 9M9.5.5l-9 9" />
    </svg>
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

  /* On a Mac the window has its own buttons (the traffic lights, top-left,
     tauri.macos.conf.json) and resizes from any edge, so ours, their aura
     and the grip go — and with nothing in the top-right corner, the drag
     strip runs all the way across. The strip can stay where it starts:
     the traffic lights are native and sit above the page anyway. */
  :global(body.platform-macos) .titlebar-controls,
  :global(body.platform-macos) .controls-aura,
  :global(body.platform-macos) .resize-grip {
    display: none;
  }
  :global(body.platform-macos) .titlebar-drag {
    right: 0;
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
     Each carries a --ctrl-color custom property; ::before is a flat
     circle that scales up behind the icon, ::after is a ripple ring
     that expands outward, and the icon itself does a small
     action-specific transform. No squares, no harsh red rectangle on
     close. */
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
  .ctrl .icon {
    position: relative;
    z-index: 2;
    display: block;
    width: 10px;
    height: 10px;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    shape-rendering: crispEdges;
    transform-origin: 50% 50%;
    transition:
      transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1),
      filter 0.18s ease;
  }
  .ctrl.close .icon {
    shape-rendering: geometricPrecision;
  }
  /* Flat colour circle behind the icon (no highlight, glow or blur);
     it still grows in on hover. */
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
    background: var(--ctrl-color, var(--accent));
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
    transform: translate(-50%, -50%) scale(3.2);
    opacity: 1;
  }
  .ctrl:hover::after {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.45;
  }

  /* Action-coded color + per-icon micro animation */
  .ctrl.min {
    --ctrl-color: #f5b54a;     /* warm amber — 'set aside' */
  }
  /* Hover micro-animations all transform around the icon's own centre so
     it never drifts off the glow. */
  .ctrl.min:hover .icon {
    transform: scaleX(1.3);
  }

  .ctrl.max {
    --ctrl-color: #5dd0d6;     /* cool cyan — 'expand' */
  }
  .ctrl.max:hover .icon {
    transform: scale(1.18);
  }

  .ctrl.close {
    --ctrl-color: #ff5e6e;     /* vivid red — 'dismiss' */
  }
  .ctrl.close:hover .icon {
    transform: rotate(90deg) scale(1.1);
  }

  @media (prefers-reduced-motion: reduce) {
    .ctrl::before,
    .ctrl::after,
    .ctrl .icon {
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
