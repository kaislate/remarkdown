<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { derivePreReleaseLabel } from '../lib/prerelease';

  // Animation timing (ms). Kept as a single source of truth.
  const HOLD_BEFORE_REVEAL = 900;     // "re.md" sits before transformation
  const REVEAL_DURATION = 1500;       // dot collapses + ark/own expand
  const HOLD_AFTER_REVEAL = 1500;     // pause on "remarkdown" + BETA pin
  const FADE_OUT_MS = 400;
  const TOTAL_MS = HOLD_BEFORE_REVEAL + REVEAL_DURATION + HOLD_AFTER_REVEAL;

  // The BETA pin starts fading in WHILE the unfold is still finishing —
  // not after — so it lands underneath the wordmark just as the
  // wordmark settles, and gets the maximum stable display time before
  // the splash fades out. The 'own' segment finishes its unfold at
  // 1.2s + 0.85s = 2050ms; pulling the pin to 1700ms means it's fully
  // visible (1700 + 550 = 2250ms) right as the wordmark completes.
  const PRE_TAG_DELAY_MS = 1700;

  let visible = $state(true);
  let fading = $state(false);
  let preTagLabel = $state<string | null>(null);

  function dismiss() {
    if (fading) return;
    fading = true;
    setTimeout(() => { visible = false; }, FADE_OUT_MS);
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await getVersion();
        if (!cancelled) preTagLabel = derivePreReleaseLabel(v);
      } catch {
        // Outside Tauri (vitest, storybook) — no tag.
      }
    })();
    const t = setTimeout(dismiss, TOTAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
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
    <div class="splash-stack">
      <h1 class="logo">
        <span class="re">re</span><!--
        --><span class="dot">.</span><!--
        --><span class="m">m</span><!--
        --><span class="ark">ark</span><!--
        --><span class="d">d</span><!--
        --><span class="own">own</span>
      </h1>

      {#if preTagLabel}
        <!-- Animated pre-release pin. Fades in after the wordmark
             finishes unfolding so it doesn't compete with the morph. -->
        <span
          class="pre-tag"
          style:animation-delay="{PRE_TAG_DELAY_MS}ms"
          aria-hidden="true"
        >
          <span class="pre-tag-text">{preTagLabel}</span>
          <span class="pre-tag-shine" aria-hidden="true"></span>
        </span>
      {/if}
    </div>
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

  /* Vertical stack so the BETA pin sits centred under the wordmark
     instead of overlapping it inside the splash grid cell. The gap is
     intentionally generous so the pin reads as related to but not
     attached to the logo. */
  .splash-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
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

  /* Pre-release pin — same visual language as the in-app GlassMenu
     pin, scaled up to read at splash sizes. Three stacked animations:
     a single fade-in (one-shot, gated by an inline animation-delay),
     plus the perpetual glow pulse + drift + shine that the GlassMenu
     pin uses. */
  .pre-tag {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 13px 5px;
    border-radius: 6px;
    overflow: hidden;
    pointer-events: none;
    background:
      linear-gradient(
        110deg,
        var(--accent) 0%,
        #b59cff 35%,
        var(--accent) 70%,
        #8b7fff 100%
      );
    background-size: 220% 100%;
    background-position: 0% 50%;
    color: #fff;
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.16em;
    line-height: 1;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    box-shadow:
      0 2px 12px rgba(139, 127, 255, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
    /* Fade-in starts hidden; the static opacity:0 holds the pin
       invisible during the inline animation-delay, then pre-tag-in
       (fill-mode: both) fades to opacity:1 and KEEPS that end-state
       while the pulse / drift / shine continue to play. */
    opacity: 0;
    animation:
      pre-tag-in 0.55s ease-out both,
      pre-tag-pulse 2.6s 0.55s ease-in-out infinite,
      pre-tag-drift 7s 0.55s linear infinite;
  }
  .pre-tag-text {
    position: relative;
    z-index: 2;
  }
  .pre-tag-shine {
    position: absolute;
    top: 0;
    left: -60%;
    width: 50%;
    height: 100%;
    background: linear-gradient(
      105deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.5) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    transform: skewX(-18deg);
    z-index: 1;
    animation: pre-tag-shine 3.4s 1.2s ease-in-out infinite;
  }
  @keyframes pre-tag-in {
    0%   { opacity: 0; transform: translateY(8px) scale(0.9); }
    100% { opacity: 1; transform: translateY(0)   scale(1);   }
  }
  @keyframes pre-tag-pulse {
    0%, 100% {
      box-shadow:
        0 2px 12px rgba(139, 127, 255, 0.5),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);
    }
    50% {
      box-shadow:
        0 4px 22px rgba(139, 127, 255, 0.85),
        inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }
  }
  @keyframes pre-tag-drift {
    0%   { background-position: 0%   50%; }
    100% { background-position: 200% 50%; }
  }
  @keyframes pre-tag-shine {
    0%   { left: -60%; }
    35%  { left: 130%; }
    100% { left: 130%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pre-tag,
    .pre-tag-shine {
      animation: none;
      opacity: 1;
    }
  }
</style>
