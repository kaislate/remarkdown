<script lang="ts">
  import { onMount } from 'svelte';

  // Animation timing (ms). Kept as a single source of truth.
  const HOLD_BEFORE_REVEAL = 900;     // "re.md" sits before transformation
  const REVEAL_DURATION = 1500;       // dot collapses + ark/own expand
  const HOLD_AFTER_REVEAL = 500;      // pause on "remarkdown"
  const FADE_OUT_MS = 400;
  const TOTAL_MS = HOLD_BEFORE_REVEAL + REVEAL_DURATION + HOLD_AFTER_REVEAL;

  let visible = $state(true);
  let fading = $state(false);

  function dismiss() {
    if (fading) return;
    fading = true;
    setTimeout(() => { visible = false; }, FADE_OUT_MS);
  }

  onMount(() => {
    const t = setTimeout(dismiss, TOTAL_MS);
    return () => clearTimeout(t);
  });
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="splash"
    class:fading
    onclick={dismiss}
    role="presentation"
    aria-hidden="true"
  >
    <h1 class="logo">
      <span class="re">re</span><!--
      --><span class="dot">.</span><!--
      --><span class="m">m</span><!--
      --><span class="ark">ark</span><!--
      --><span class="d">d</span><!--
      --><span class="own">own</span>
    </h1>
  </div>
{/if}

<style>
  .splash {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    background:
      radial-gradient(circle at 28% 32%, var(--glow-1), transparent 55%),
      radial-gradient(circle at 72% 68%, var(--glow-2), transparent 55%),
      var(--bg-0);
    transition: opacity 0.4s ease;
    user-select: none;
    cursor: pointer;
  }
  .splash.fading {
    opacity: 0;
    pointer-events: none;
  }

  .logo {
    margin: 0;
    font-family: var(--font-sans);
    font-size: clamp(48px, 8vw, 96px);
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--fg-0);
    white-space: nowrap;
    /* Subtle gentle reveal of the whole logo at the start. */
    animation: logoIn 0.6s 0.1s ease-out backwards;
  }
  @keyframes logoIn {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .logo span {
    display: inline-block;
    vertical-align: baseline;
  }

  /* The dot collapses: it fades, drops a touch, and its space evaporates so
     the surrounding letters slide together naturally. */
  .dot {
    color: var(--accent);
    animation: dotOut 0.55s 0.9s forwards cubic-bezier(0.5, 0, 0.7, 0.4);
    transform-origin: center;
  }
  @keyframes dotOut {
    0%   { opacity: 1; max-width: 0.45em; transform: translateY(0) scale(1); }
    100% { opacity: 0; max-width: 0;      transform: translateY(0.4em) scale(0.6); }
  }

  /* "ark" and "own" expand from zero width — `max-width` drives the layout
     so surrounding letters slide together, and `clip-path` hides the
     overflowing letters until the box is wide enough to reveal them. Using
     clip-path instead of `overflow: hidden` is deliberate: overflow !=
     visible on an inline-block makes its baseline the bottom margin edge
     (CSS 2.1 §10.8.1), which would raise the inner text into a
     superscript-like position relative to the surrounding letters. With
     overflow staying visible the inline-block's baseline is the natural
     text baseline and "remarkdown" reads as a single horizontal line. */
  .ark, .own {
    max-width: 0;
    clip-path: inset(0 100% 0 0);
  }
  .ark {
    animation: unfold 0.85s 1.0s forwards cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .own {
    animation: unfold 0.85s 1.2s forwards cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  @keyframes unfold {
    0%   { max-width: 0;     opacity: 0.4; clip-path: inset(0 100% 0 0); }
    100% { max-width: 4.5ch; opacity: 1;   clip-path: inset(0 0 0 0);    }
  }
</style>
