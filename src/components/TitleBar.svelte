<script lang="ts">
  // Custom title bar for a frameless Tauri window. Provides drag-to-move plus
  // minimize / maximize / close controls. Everything is laid over the top of the
  // canvas so the reading surface runs full-bleed to the window edge.
  import { getCurrentWindow } from '@tauri-apps/api/window';

  async function safeCall(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch {
      // When running outside a Tauri webview (e.g., Playwright E2E in vanilla
      // Chromium), the IPC bridge is absent. Swallow — there's nothing useful
      // we can do and crashing the UI would be worse.
    }
  }

  const minimize = () => safeCall(() => getCurrentWindow().minimize());
  const toggleMaximize = () => safeCall(() => getCurrentWindow().toggleMaximize());
  const close = () => safeCall(() => getCurrentWindow().close());
</script>

<div class="titlebar" data-tauri-drag-region>
  <div class="controls">
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
</div>

<style>
  .titlebar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 32px;
    z-index: 150;
    /* Transparent — the reading canvas shows through. The strip is still the
       drag handle for the whole top of the window. */
    background: transparent;
    display: flex;
    justify-content: flex-end;
    align-items: stretch;
    /* The strip itself is pointer-passthrough for scroll wheel events but
       active for drag + button clicks. Leaving auto so drag region works. */
  }
  .controls {
    display: flex;
    align-items: stretch;
  }
  .ctrl {
    background: transparent;
    border: 0;
    color: var(--fg-2);
    width: 44px;
    cursor: pointer;
    display: grid;
    place-items: center;
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1;
    transition: background 0.15s ease, color 0.15s ease;
    padding: 0;
  }
  .ctrl:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--fg-0);
  }
  .ctrl.close:hover {
    background: #e74c3c;
    color: #fff;
  }
</style>
