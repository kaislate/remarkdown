<script lang="ts">
  import { isWelcomeDocOpen } from '../stores/welcome';
  import { settings, updateSettings } from '../stores/settings';
  import FileArrowDown from 'phosphor-svelte/lib/FileArrowDown';

  function dismiss() {
    updateSettings({ welcomeTutorialDismissed: true });
  }
</script>

{#if $isWelcomeDocOpen && !$settings.welcomeTutorialDismissed}
  <!-- Backdrop is a sibling (NOT a child) of the overlay so the minimap
       (z:85) can stack above the backdrop (z:80) but below the overlay's
       tips (z:90). pointer-events:none keeps every chrome element
       underneath fully clickable through it. -->
  <div class="backdrop" aria-hidden="true"></div>

  <div class="overlay" aria-label="Welcome tutorial">
    <!-- Shared SVG filter for the hand-drawn arrow stroke effect. The
         feTurbulence generates fractal noise; feDisplacementMap pushes each
         point of the source path along the X/Y axes by the noise field —
         producing a wobble that looks like ink being laid down by a
         slightly unsteady hand. The filter ID is referenced by every
         arrow path's filter attribute. -->
    <svg width="0" height="0" aria-hidden="true" style="position:fixed; pointer-events:none">
      <defs>
        <filter id="rough-arrow" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7"/>
          <feDisplacementMap in="SourceGraphic" scale="3.5"/>
        </filter>
        <filter id="rough-arrow-strong" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="11"/>
          <feDisplacementMap in="SourceGraphic" scale="2.5"/>
        </filter>
      </defs>
    </svg>

    <!-- Tip 1: Hamburger menu -->
    <div class="tip tip-hamburger">
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true">
        <g filter="url(#rough-arrow)">
          <path d="M 70,60 Q 40,30 18,12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M 8,6 L 24,8 L 18,22 Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
        </g>
      </svg>
      <div class="label">Open <code>.md</code> files and settings here</div>
    </div>

    <!-- Tip 2: Drag-drop hint -->
    <div class="tip tip-drag">
      <span class="icon" aria-hidden="true">
        <FileArrowDown size={28} weight="regular" />
      </span>
      <div class="label">…or drop any <code>.md</code> file into the window</div>
    </div>

    <!-- Tip 3: Minimap bracket -->
    <div class="bracket-row" aria-hidden="true">
      <div class="bracket-label">Navigate long documents here</div>
      <svg class="bracket" viewBox="0 0 24 200" preserveAspectRatio="none" aria-hidden="true">
        <g filter="url(#rough-arrow-strong)">
          <!-- Spine on the LEFT side (x=6) with arms extending RIGHT
               toward the minimap (x=20). Visually like `[` — the
               bracket's opening faces the minimap, embracing it. -->
          <path d="M 20,2 L 6,2 L 6,198 L 20,198" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        </g>
      </svg>
    </div>

    <!-- Tip 4: Annotation tools (bottom-right) -->
    <div class="tip tip-tools">
      <div class="label">Add annotations using these tools</div>
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true">
        <g filter="url(#rough-arrow)">
          <path d="M 10,10 Q 40,40 62,58" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M 72,64 L 56,62 L 62,48 Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
        </g>
      </svg>
    </div>

    <!-- Tip 5: Title bar drag area (top-center) -->
    <div class="tip tip-titlebar">
      <svg class="arrow" viewBox="0 0 30 60" width="30" height="60" aria-hidden="true">
        <g filter="url(#rough-arrow)">
          <path d="M 15,55 L 15,16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M 15,4 L 24,18 L 6,18 Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
        </g>
      </svg>
      <div class="label">Hold to drag the window from here</div>
    </div>

    <!-- Tip 6: Zoom pill (bottom-left). Arrow leads with its head pointing
         DOWN-LEFT at the zoom pill; the label sits to the right of the
         arrow as the visual continuation of the trail. -->
    <div class="tip tip-zoom">
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true">
        <g filter="url(#rough-arrow)">
          <path d="M 70,10 Q 40,40 18,58" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M 8,64 L 14,48 L 24,58 Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
        </g>
      </svg>
      <div class="label">Resize your view here</div>
    </div>

    <!-- Got-it dismiss. Bottom-center, away from the chrome being explained. -->
    <button class="dismiss-tutorial" onclick={dismiss}>
      Got it — dismiss tutorial
    </button>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 90;
    pointer-events: none;
    color: var(--accent);
    /* Gentle entrance so the overlay doesn't snap on top of the welcome
       doc as it renders. */
    animation: fadeIn 600ms ease-out 400ms backwards;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* Backdrop blurs the canvas behind everything below z:80. The minimap
     (z:85) sits above this backdrop and stays sharp; the tips and
     dismiss button (inside .overlay at z:90) sit even higher and also
     stay sharp. pointer-events:none keeps chrome clickable through it. */
  .backdrop {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 80;
    backdrop-filter: blur(5px) saturate(0.85);
    -webkit-backdrop-filter: blur(5px) saturate(0.85);
    background: rgba(11, 10, 18, 0.32);
  }

  /* Tip wrapper: pointer-events: auto so the bubble responds to hover.
     Children inherit. The hover animation lifts and tilts the tip a hair
     — playful, like a sticky note rising off the page. */
  .tip {
    position: fixed;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    pointer-events: auto;
    transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transform-origin: center center;
  }
  .tip:hover {
    transform: scale(1.06) rotate(-1.2deg);
  }
  /* The bracket-row is also a tip-style hoverable element, but with its
     own positioning and a different idle rotation. */
  .bracket-row {
    transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .bracket-row:hover {
    transform: scale(1.04);
  }

  /* Script-style font for tutorial copy. The font stack prefers a system
     handwriting font on each platform, falling through to the generic
     `cursive` family. Inline <code> elements are excluded — see below. */
  .label,
  .bracket-label,
  .dismiss-tutorial {
    font-family:
      'Segoe Script',
      'Bradley Hand',
      'Marker Felt',
      'Caveat',
      'Patrick Hand',
      'Comic Sans MS',
      cursive;
    /* Script fonts run small at the same px size as sans, so bump up. */
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .label {
    background: linear-gradient(var(--bg-1), var(--bg-1)), var(--glass-fill);
    color: var(--fg-0);
    border: 1px solid var(--accent-soft);
    padding: 7px 12px;
    border-radius: 8px;
    max-width: 220px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    line-height: 1.4;
  }
  /* Re-style inline <code> back to monospace so things like ".md" stay
     in the canonical mono treatment despite the script-font surroundings. */
  .label code {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: normal;
    background: var(--bg-2);
    color: var(--accent);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .arrow {
    color: var(--accent);
    flex-shrink: 0;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }
  .icon {
    color: var(--accent);
    margin-top: 2px;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }

  /* Tip 1 — points at the hamburger (top-left). The arrow rises up and
     to the left toward the menu button at (~33, 33). */
  .tip-hamburger {
    top: 70px;
    left: 70px;
    flex-direction: row;
  }

  /* Tip 2 — sits below and to the right of Tip 1, no arrow (the file
     icon serves as its own visual anchor). */
  .tip-drag {
    top: 150px;
    left: 170px;
    flex-direction: row;
    align-items: center;
  }

  /* Tip 3 — vertical bracket alongside the minimap. Minimap is at
     right:16, top:52, bottom:110, so the bracket spans that region with
     a small inset on each end. The label sits to the bracket's left. */
  .bracket-row {
    position: fixed;
    top: 60px;
    right: 162px;
    bottom: 118px;
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
    color: var(--accent);
  }
  .bracket-label {
    background: linear-gradient(var(--bg-1), var(--bg-1)), var(--glass-fill);
    color: var(--fg-0);
    border: 1px solid var(--accent-soft);
    padding: 7px 12px;
    border-radius: 8px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    line-height: 1.4;
    white-space: nowrap;
  }
  .bracket {
    height: 100%;
    width: 24px;
    color: var(--accent);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }

  /* Tip 4 — annotation tools at bottom-right. Bubble + arrow above-left
     of the tool pill (which sits at right:22, bottom:22 ~190px wide). */
  .tip-tools {
    bottom: 76px;
    right: 220px;
    flex-direction: row;
    align-items: flex-end;
  }

  /* Tip 5 — title bar drag region. Bubble below the title bar centre,
     arrow points up. transform-origin compensates for the centring
     translateX so the hover scale anchors at the bubble's true centre. */
  .tip-titlebar {
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    flex-direction: row;
    align-items: center;
  }
  .tip-titlebar:hover {
    transform: translateX(-50%) scale(1.06) rotate(-1.2deg);
  }

  /* Tip 6 — zoom pill at bottom-left (bottom:22, left:22, ~120px wide).
     Bubble above-right of the pill, arrow points down-left. */
  .tip-zoom {
    bottom: 76px;
    left: 160px;
    flex-direction: row;
    align-items: flex-end;
  }

  /* Dismiss button — re-enables pointer-events so the user can click it.
     Bottom-centre keeps it away from the watermark, the zoom pill, and
     the annotation tools. Same script-font treatment as the labels for
     visual consistency with the tutorial language. */
  .dismiss-tutorial {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    pointer-events: auto;
    background: var(--accent);
    color: #fff;
    border: 0;
    padding: 8px 18px;
    border-radius: 999px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(139, 127, 255, 0.35);
    transition: filter 0.15s ease, transform 0.2s ease;
  }
  .dismiss-tutorial:hover {
    filter: brightness(1.1);
    transform: translateX(-50%) translateY(-2px) scale(1.04);
  }
  .dismiss-tutorial:focus-visible {
    outline: 2px solid var(--fg-0);
    outline-offset: 2px;
  }
</style>
