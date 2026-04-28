<script lang="ts">
  import { onMount } from 'svelte';
  import { cursorState, collapseCursor } from '../stores/cursor';

  let el = $state<HTMLDivElement | null>(null);

  onMount(() => {
    if (typeof window === 'undefined') return;
    const isTouch = matchMedia('(hover: none)').matches;
    if (isTouch) return;

    const pos = { x: 0, y: 0 };

    const onMove = (e: MouseEvent) => {
      // Lerp smoothing — the cursor lags the real mouse by ~4 frames'
      // worth of drag, giving the slightly-floaty premium feel.
      pos.x += (e.clientX - pos.x) / 4;
      pos.y += (e.clientY - pos.y) / 4;
      if (el) {
        el.style.setProperty('--x', `${pos.x}px`);
        el.style.setProperty('--y', `${pos.y}px`);
      }
    };

    // Safety nets so the cursor cannot get "stuck" if the webview
    // swallows a mouseleave (WebKitGTK on Linux occasionally does).
    const onLeave = () => collapseCursor();

    document.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  });
</script>

<div
  bind:this={el}
  class="mouse-cursor"
  class:active={$cursorState.active}
  class:pressed={$cursorState.pressed}
  aria-hidden="true"
>
  <svg class="cursor-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor">
    <path
      d="M10 30L30 10M10 10L30 30"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</div>

<style>
  .mouse-cursor {
    position: fixed;
    top: var(--y, -100px);
    left: var(--x, -100px);
    transform: translate(-50%, -60%);
    width: 0;
    height: 0;
    z-index: 9999;
    pointer-events: none;
    user-select: none;
    border-radius: 9999px;
    color: var(--bg-0);
    background-color: var(--fg-0);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: width var(--animation-fast-out), height var(--animation-fast-out);
  }
  .mouse-cursor :global(.cursor-icon) {
    width: 0;
    height: 0;
    transition: width var(--animation-fast-out), height var(--animation-fast-out);
  }
  .mouse-cursor.active {
    width: var(--cursor-size);
    height: var(--cursor-size);
    transition: width var(--animation-fast), height var(--animation-fast);
  }
  .mouse-cursor.active :global(.cursor-icon) {
    width: var(--cursor-icon-size);
    height: var(--cursor-icon-size);
    transition: width var(--animation-fast), height var(--animation-fast);
  }
  .mouse-cursor.active.pressed {
    width: calc(var(--cursor-size) * var(--cursor-pressed-scale));
    height: calc(var(--cursor-size) * var(--cursor-pressed-scale));
  }
  .mouse-cursor.active.pressed :global(.cursor-icon) {
    width: calc(var(--cursor-icon-size) * var(--cursor-pressed-scale));
    height: calc(var(--cursor-icon-size) * var(--cursor-pressed-scale));
  }
</style>
