<script lang="ts">
  import {
    tutorialOverlayVisible,
    dismissTutorialForSession,
    dismissTutorialForever,
  } from '../stores/tutorial';
  import FileArrowDown from 'phosphor-svelte/lib/FileArrowDown';
  import rough from 'roughjs';
  import type { Options } from 'roughjs/bin/core';

  // Visibility lives in src/stores/tutorial.ts so the global '?' key
  // handler in App.svelte can toggle it. The two dismiss buttons here
  // call the store helpers, which set the relevant flags (session vs
  // persisted) and clear the force-shown flag at the same time.

  function dismissForSession() {
    dismissTutorialForSession();
  }

  function dismissForever() {
    dismissTutorialForever();
  }

  // Toggle a body class while the tutorial is active so global CSS can
  // suppress text selection on the canvas behind the overlay. Without
  // this, dragging anywhere on the welcome doc selects article text and
  // disrupts the read-the-tutorial flow.
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('tutorial-active', $tutorialOverlayVisible);
    return () => {
      document.body.classList.remove('tutorial-active');
    };
  });

  // Each arrow is described as a sequence of paths. roughjs renders each
  // one with hand-drawn jitter, multiple slightly-offset strokes, and the
  // characteristic ink-laid-down feel that pure SVG filters can't quite
  // reproduce. The action below mounts them on the bound <svg> at the
  // moment that element appears in the DOM.
  type RoughPath = { d: string; fill?: string; strokeWidth?: number };

  const ROUGH_DEFAULTS: Options = {
    stroke: 'currentColor',
    strokeWidth: 3,
    roughness: 2.4,
    bowing: 2,
    seed: 42,
  };

  function drawRough(svg: SVGSVGElement, paths: RoughPath[]) {
    const rc = rough.svg(svg);
    const elements = paths.map((p) => {
      const opts: Options = {
        ...ROUGH_DEFAULTS,
        strokeWidth: p.strokeWidth ?? ROUGH_DEFAULTS.strokeWidth,
      };
      if (p.fill) {
        opts.fill = p.fill;
        opts.fillStyle = 'solid';
      }
      const el = rc.path(p.d, opts);
      svg.appendChild(el);
      return el;
    });
    return {
      destroy() {
        elements.forEach((el) => el.remove());
      },
    };
  }

  // Path data for each arrow + its arrowhead. Arrowheads are filled with
  // currentColor so they read as the arrow's tip rather than just an
  // outlined triangle. Each arrow gets a unique `seed` via path index +
  // base seed so neighbouring arrows don't look like clones.
  const arrowHamburger: RoughPath[] = [
    { d: 'M 70,60 Q 40,30 18,12', strokeWidth: 3 },
    { d: 'M 8,6 L 24,8 L 18,22 Z', fill: 'currentColor', strokeWidth: 1.5 },
  ];
  const arrowTools: RoughPath[] = [
    { d: 'M 10,10 Q 40,40 62,58', strokeWidth: 3 },
    { d: 'M 72,64 L 56,62 L 62,48 Z', fill: 'currentColor', strokeWidth: 1.5 },
  ];
  const arrowTitlebar: RoughPath[] = [
    { d: 'M 15,55 L 15,16', strokeWidth: 3 },
    { d: 'M 15,4 L 24,18 L 6,18 Z', fill: 'currentColor', strokeWidth: 1.5 },
  ];
  const arrowZoom: RoughPath[] = [
    { d: 'M 70,10 Q 40,40 18,58', strokeWidth: 3 },
    { d: 'M 8,64 L 14,48 L 24,58 Z', fill: 'currentColor', strokeWidth: 1.5 },
  ];
  // Re.marks pill is just above the zoom pill at left:22, bottom:68.
  // S-curve (cubic bezier with control points pulling in OPPOSITE
  // directions) gives this arrow a distinctly wavy silhouette so it
  // doesn't read as a duplicate of the zoom tip's plain diagonal.
  const arrowRemarks: RoughPath[] = [
    { d: 'M 70,8 C 80,30 5,38 18,58', strokeWidth: 3 },
    { d: 'M 8,64 L 14,48 L 24,58 Z', fill: 'currentColor', strokeWidth: 1.5 },
  ];
  // Bracket spine + arms — drawn as three short strokes rather than one
  // continuous path so each segment gets its own jitter and reads as
  // separate pen strokes laid down in sequence (which is how a person
  // would actually draw a bracket of this shape).
  const bracketPaths: RoughPath[] = [
    { d: 'M 20,2 L 6,2', strokeWidth: 2.5 },           // top arm
    { d: 'M 6,2 L 6,198', strokeWidth: 2.5 },          // spine
    { d: 'M 6,198 L 20,198', strokeWidth: 2.5 },       // bottom arm
  ];

  // Visual connector linking Tip 1 (Open .md files) to Tip 2 (drag-drop
  // hint) — same hand-drawn line style as the arrows but with no
  // arrowhead. Shape is a J-hook: a near-vertical drop from below
  // Tip 1's lower edge, then a sweep to the right that lands just
  // before the file icon of Tip 2.
  const connectorTip1to2: RoughPath[] = [
    { d: 'M 8,4 C 4,28 4,45 46,55', strokeWidth: 2.5 },
  ];
</script>

{#if $tutorialOverlayVisible}
  <!-- Backdrop is a sibling (NOT a child) of the overlay so the minimap
       (z:85) can stack above the backdrop (z:80) but below the overlay's
       tips (z:90). pointer-events:none keeps every chrome element
       underneath fully clickable through it. -->
  <div class="backdrop" aria-hidden="true"></div>

  <div class="overlay" aria-label="Welcome tutorial">
    <!-- Tip 1: Hamburger menu -->
    <div class="tip tip-hamburger">
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true" use:drawRough={arrowHamburger}></svg>
      <div class="label">Open <code>.md</code> files and settings here</div>
    </div>

    <!-- Curved hand-drawn connector from Tip 1 down to Tip 2's icon. No
         arrowhead — purely a visual link between the two related tips. -->
    <svg
      class="connector connector-tip1-tip2"
      viewBox="0 0 56 60"
      width="56"
      height="60"
      aria-hidden="true"
      use:drawRough={connectorTip1to2}
    ></svg>

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
      <svg class="bracket" viewBox="0 0 24 200" preserveAspectRatio="none" aria-hidden="true" use:drawRough={bracketPaths}></svg>
    </div>

    <!-- Tip 4: Annotation tools (bottom-right) -->
    <div class="tip tip-tools">
      <div class="label">Add annotations using these tools</div>
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true" use:drawRough={arrowTools}></svg>
    </div>

    <!-- Tip 5: Title bar drag area (top-center). Column layout so the
         label sits BELOW the arrow; the arrow's head points up at the
         centre of the title bar. -->
    <div class="tip tip-titlebar">
      <svg class="arrow" viewBox="0 0 30 60" width="30" height="60" aria-hidden="true" use:drawRough={arrowTitlebar}></svg>
      <div class="label">Hold to drag the window from here</div>
    </div>

    <!-- Tip 6: Zoom pill (bottom-left). Arrow leads with its head pointing
         DOWN-LEFT at the zoom pill; the label sits to the right of the
         arrow as the visual continuation of the trail. -->
    <div class="tip tip-zoom">
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true" use:drawRough={arrowZoom}></svg>
      <div class="label">Resize your view here</div>
    </div>

    <!-- Tip 7: Re.marks pill (bottom-left, immediately above zoom).
         Diagonal down-left arrow points toward the pill. Stacked
         above the zoom tip so the two tips don't visually crowd. -->
    <div class="tip tip-remarks">
      <svg class="arrow" viewBox="0 0 80 70" width="80" height="70" aria-hidden="true" use:drawRough={arrowRemarks}></svg>
      <div class="label">Browse and jump to your re<span class="brand-dot">.</span>marks here</div>
    </div>

    <!-- Stacked dismiss controls at bottom-centre. The pill button is
         the primary action (session-only dismiss, resets next launch);
         the PURPLE LINK below is the permanent dismiss (sets the
         persisted setting). -->
    <div class="dismiss-stack">
      <button class="dismiss-tutorial" onclick={dismissForSession}>
        Got it — dismiss tutorial
      </button>
      <button class="dismiss-forever" onclick={dismissForever}>
        Hide tutorial forever (reshow in settings)
      </button>
    </div>
  </div>
{/if}

<style>
  /* Suppress text selection on the entire app while the tutorial overlay
     is active. Applied globally because the article content lives in
     other Svelte component scopes. */
  :global(body.tutorial-active),
  :global(body.tutorial-active *) {
    user-select: none;
    -webkit-user-select: none;
  }

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

  /* Handwritten font stack for tutorial copy. Prefers a system print-
     handwriting font on each platform; falls through to popular Google-
     fonts handwritten faces in case the user has them locally; finally
     to Comic Sans / generic cursive. Inline <code> elements are
     re-overridden back to monospace below. */
  .label,
  .bracket-label,
  .dismiss-tutorial {
    font-family:
      'Segoe Print',
      'Patrick Hand',
      'Architects Daughter',
      'Kalam',
      'Indie Flower',
      'Comic Sans MS',
      'Bradley Hand',
      'Marker Felt',
      cursive;
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
     in the canonical mono treatment despite the handwritten surroundings. */
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

  /* Tip 1 — points at the hamburger (top-left). The arrow's tail sits
     at the bottom-right of its SVG (the curve sweeps up-left to the
     hamburger), so align-items: flex-end pulls the label down so it
     sits visually anchored to the tail of the arrow. */
  .tip-hamburger {
    top: 70px;
    left: 70px;
    flex-direction: row;
    align-items: flex-end;
  }
  /* Push only the label down to sit at/below the arrow's tail without
     moving the arrow itself. position: relative shifts the rendering
     without disturbing the flex layout. */
  .tip-hamburger .label {
    position: relative;
    top: 25px;
  }

  /* Tip 2 — sits below and to the right of Tip 1's anchored label, in
     the empty space to the right of where the watermark would be. */
  .tip-drag {
    top: 200px;
    left: 250px;
    flex-direction: row;
    align-items: center;
  }

  /* Connector between Tip 1 and Tip 2 — hand-drawn J-hook curve, no
     arrowhead. Drops from below Tip 1's lower edge, then sweeps right
     to land at the file icon of Tip 2. Pure decoration. */
  .connector-tip1-tip2 {
    position: fixed;
    top: 165px;
    left: 200px;
    pointer-events: none;
    color: var(--accent);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
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

  /* Tip 4 — annotation tools at bottom-right. Arrow tail sits at the
     top-LEFT of its SVG (curve sweeps down-right to the tool rail), so
     align-items: flex-start pulls the label up so it sits visually
     anchored to the tail. */
  .tip-tools {
    bottom: 76px;
    right: 220px;
    flex-direction: row;
    align-items: flex-start;
  }
  /* Pull only the label up to sit at/above the arrow's tail without
     moving the arrow itself. */
  .tip-tools .label {
    position: relative;
    top: -24px;
  }

  /* Tip 5 — title bar drag region. Stacked column: arrow on top
     (pointing UP at the title bar centre), label below it, both
     horizontally centred within the tip. transform-origin compensates
     for the centring translateX so the hover scale anchors true. */
  .tip-titlebar {
    top: 50px;
    left: 50%;
    transform: translateX(-50%);
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .tip-titlebar:hover {
    transform: translateX(-50%) scale(1.06) rotate(-1.2deg);
  }

  /* Tip 6 — zoom pill at bottom-left. Arrow tail sits at the top-RIGHT
     of its SVG (curve sweeps down-left to the zoom pill), so
     align-items: flex-start pulls the label up so it sits visually
     anchored to the tail. */
  .tip-zoom {
    bottom: 40px;
    left: 148px;
    flex-direction: row;
    align-items: flex-start;
  }
  /* Pull only the label up to sit at/above the arrow's tail without
     moving the arrow itself. */
  .tip-zoom .label {
    position: relative;
    top: -24px;
  }

  /* Tip 7 — re.marks pill (just above the zoom pill at left:22, bottom:68,
     ~85px wide → centre near screen (60, 83 from bottom)).

     column-reverse so the LABEL ends up on top (clear of the zoom
     tip's label band) and the SVG sits at the BOTTOM of the tip
     element where its head can reach the pill. */
  .tip-remarks {
    bottom: 98px;
    left: 72px;
    flex-direction: column-reverse;
    align-items: flex-start;
    gap: 0;
  }
  .tip-remarks .label .brand-dot {
    color: var(--accent);
    font-family: var(--font-mono);
  }

  /* Bottom-centre stack: a purple text link for the permanent dismiss
     sits just above the session-dismiss pill button so users see both
     options as a vertical pair. Both re-enable pointer-events so the
     user can click them. */
  .dismiss-stack {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }
  .dismiss-forever,
  .dismiss-tutorial {
    pointer-events: auto;
  }

  /* Permanent dismiss — purple link styling, no chrome. Same handwritten
     stack as the rest of the tutorial copy, smaller weight. Centred via
     the parent flex column. */
  .dismiss-forever {
    background: transparent;
    border: 0;
    color: var(--accent);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 12px;
    font-weight: 500;
    text-decoration: underline dashed;
    text-underline-offset: 3px;
    transition: filter 0.15s ease;
  }
  .dismiss-forever:hover {
    filter: brightness(1.18);
  }
  .dismiss-forever:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 4px;
    border-radius: 4px;
  }

  /* Session dismiss — same handwritten-font treatment as the labels for
     visual consistency with the tutorial language. */
  .dismiss-tutorial {
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
    transform: translateY(-2px) scale(1.04);
  }
  .dismiss-tutorial:focus-visible {
    outline: 2px solid var(--fg-0);
    outline-offset: 2px;
  }
</style>
