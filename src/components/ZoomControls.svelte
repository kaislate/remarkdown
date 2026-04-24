<script lang="ts">
  import { zoomLevel, increaseZoom, decreaseZoom, resetZoom, ZOOM_LEVELS } from '../stores/ui';

  const minZoom = ZOOM_LEVELS[0];
  const maxZoom = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
</script>

<div class="zoom-rail glass glass-pill" role="group" aria-label="Zoom">
  <button
    class="btn"
    aria-label="Zoom out"
    title="Zoom out (Ctrl + −)"
    disabled={$zoomLevel <= minZoom}
    onclick={decreaseZoom}
  >
    <span aria-hidden="true">−</span>
  </button>
  <button
    class="btn level"
    aria-label={`Zoom: ${Math.round($zoomLevel * 100)} percent. Click to reset.`}
    title="Reset zoom (Ctrl + 0)"
    onclick={resetZoom}
  >
    {Math.round($zoomLevel * 100)}%
  </button>
  <button
    class="btn"
    aria-label="Zoom in"
    title="Zoom in (Ctrl + +)"
    disabled={$zoomLevel >= maxZoom}
    onclick={increaseZoom}
  >
    <span aria-hidden="true">+</span>
  </button>
</div>

<style>
  .zoom-rail {
    position: fixed;
    bottom: 22px;
    left: 22px;
    display: flex;
    align-items: stretch;
    padding: 4px;
    z-index: 100;
  }
  .btn {
    background: transparent;
    border: 0;
    color: var(--fg-1);
    height: 30px;
    min-width: 30px;
    padding: 0 8px;
    border-radius: 999px;
    cursor: pointer;
    display: grid;
    place-items: center;
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .btn.level {
    min-width: 48px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-1);
  }
  .btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: var(--fg-0);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
