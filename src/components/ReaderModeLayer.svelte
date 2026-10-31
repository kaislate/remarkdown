<script lang="ts" module>
  // How long the "Press Esc" hint stays after entering reader mode. The
  // fade in / out is CSS (keyframes below) inside this same window.
  export const HINT_MS = 2500;
</script>

<script lang="ts">
  // The only things reader mode adds on top of the page:
  //   - an invisible band along the top edge that still moves the window
  //     (the title bar is hidden with the rest of the chrome; the window
  //     buttons stay, muted, on the same line);
  //   - a quiet back arrow beside the menu button (which stays, boxless —
  //     reader-mode.css), the other way out besides Esc;
  //   - a short hint on entry saying how to get out.
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
  import { readerMode, exitReaderMode } from '../stores/reader-mode';

  function reducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }

  let hint = $state(false);
  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  function clearHint() {
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    hint = false;
  }

  onMount(() => {
    // Any way into reader mode counts as an entry — the toggle, "Always
    // open documents in reader mode", or switching to a tab that is in it.
    let was = false;
    const unsub = readerMode.subscribe((on) => {
      if (on && !was) {
        clearHint();
        hint = true;
        hintTimer = setTimeout(clearHint, HINT_MS);
      } else if (!on) {
        clearHint();
      }
      was = on;
    });
    return () => {
      unsub();
      clearHint();
    };
  });

  // Same click-or-drag rule as the title bar: start the OS drag only once
  // the pointer has moved a few px, so a double-click still reaches us.
  const DRAG_THRESHOLD_SQ = 4 * 4;

  function onBandPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const band = e.currentTarget as HTMLElement;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (m: PointerEvent) => {
      const dx = m.clientX - startX;
      const dy = m.clientY - startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;
      cleanup();
      void Promise.resolve()
        .then(() => getCurrentWindow().startDragging())
        .catch(() => { /* outside Tauri */ });
    };
    const cleanup = () => {
      band.removeEventListener('pointermove', onMove);
      band.removeEventListener('pointerup', cleanup);
      band.removeEventListener('pointercancel', cleanup);
      try { band.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    };
    try { band.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    band.addEventListener('pointermove', onMove);
    band.addEventListener('pointerup', cleanup);
    band.addEventListener('pointercancel', cleanup);
  }

  function onBandDoubleClick(e: MouseEvent) {
    e.preventDefault();
    void Promise.resolve()
      .then(() => getCurrentWindow().toggleMaximize())
      .catch(() => { /* outside Tauri */ });
  }
</script>

{#if $readerMode}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="reader-drag-band"
    data-tauri-drag-region
    role="presentation"
    onpointerdown={onBandPointerDown}
    ondblclick={onBandDoubleClick}
  ></div>
  <button
    class="reader-back"
    aria-label="Leave reader mode"
    title="Leave reader mode (Esc)"
    onclick={exitReaderMode}
    in:fly={{ x: -10, duration: reducedMotion() ? 0 : 280, delay: reducedMotion() ? 0 : 120 }}
    out:fade={{ duration: reducedMotion() ? 0 : 160 }}
  >
    <ArrowLeft size={16} weight="bold" />
  </button>
{/if}

{#if hint}
  <div class="reader-hint" role="status" aria-live="polite">
    Press <kbd>Esc</kbd> to leave reader mode
  </div>
{/if}

<style>
  .reader-drag-band {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 38px;
    z-index: 50;
    background: transparent;
  }

  /* Just right of the menu button (14–52px), centred on it. Faint at
     rest, in the page's own ink. */
  .reader-back {
    position: fixed;
    top: calc(19px + var(--chrome-inset-top));
    left: 58px;
    width: 28px;
    height: 28px;
    /* Above the menu's row (z:130, which spans the faded wordmark this
       sits over), below the window buttons. */
    z-index: 135;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--fg-2);
    opacity: 0.6;
    cursor: pointer;
    transition: opacity 0.18s ease, background-color 0.18s ease, color 0.18s ease;
  }
  .reader-back:hover,
  .reader-back:focus-visible {
    opacity: 1;
    color: var(--fg-0);
    background: var(--glass-fill);
  }
  .reader-back:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* Bottom centre, in the page's own muted ink (reader-mode.css sets the
     tokens per reader theme) on a soft wash of the page colour so it
     stays readable over text. */
  .reader-hint {
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    z-index: 300;
    padding: 7px 14px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-0) 88%, transparent);
    border: 1px solid var(--glass-border);
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 12px;
    letter-spacing: 0.01em;
    white-space: nowrap;
    pointer-events: none;
    animation: reader-hint 2.5s ease both;
  }
  .reader-hint kbd {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-1);
    padding: 1px 5px;
    border: 1px solid var(--glass-border);
    border-radius: 4px;
  }
  @keyframes reader-hint {
    0%   { opacity: 0; transform: translate(-50%, 4px); }
    14%  { opacity: 1; transform: translate(-50%, 0); }
    82%  { opacity: 1; transform: translate(-50%, 0); }
    100% { opacity: 0; transform: translate(-50%, 0); }
  }
  /* No fade: shown, then gone after the same 2.5s. */
  @media (prefers-reduced-motion: reduce) {
    .reader-hint { animation: none; }
  }
</style>
