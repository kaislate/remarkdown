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
  import { getCurrentWindow } from '@tauri-apps/api/window';

  async function safeCall(fn: () => Promise<unknown>) {
    try { await fn(); } catch { /* outside Tauri */ }
  }

  async function onDragPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    await safeCall(() => getCurrentWindow().startDragging());
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
  .ctrl {
    background: transparent;
    border: 0;
    color: var(--fg-1);
    width: 44px;
    cursor: pointer;
    display: grid;
    place-items: center;
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1;
    padding: 0;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .ctrl:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--fg-0);
  }
  .ctrl.close:hover {
    background: #e74c3c;
    color: #fff;
  }
</style>
