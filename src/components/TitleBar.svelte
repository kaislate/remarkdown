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

<div class="titlebar-controls glass">
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
    right: 168px;  /* clear the controls pill width */
    height: 38px;
    z-index: 50;   /* below the hamburger (100) */
    background: transparent;
  }
  .titlebar-controls {
    position: fixed;
    top: 0;
    right: 0;
    display: flex;
    align-items: stretch;
    height: 38px;
    z-index: 180;  /* above the minimap (60) */
    border: 1px solid var(--glass-border);
    border-top: 0;
    border-right: 0;
    border-radius: 0 0 0 12px;
    overflow: hidden;
    background: rgba(17, 15, 25, 0.72);
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
  }
  .ctrl {
    background: transparent;
    border: 0;
    color: var(--fg-1);
    width: 48px;
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
