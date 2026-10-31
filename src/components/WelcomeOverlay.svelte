<script lang="ts">
  import { formatShortcut } from '../lib/shortcuts';
  import { isMac } from '../lib/platform';
  import { onDestroy, tick } from 'svelte';
  import {
    tutorialOverlayVisible,
    dismissTutorialForSession,
    dismissTutorialForever,
  } from '../stores/tutorial';
  import { settings } from '../stores/settings';
  import { minimapShown } from '../stores/ui';
  import FileArrowDown from 'phosphor-svelte/lib/FileArrowDown';
  import rough from 'roughjs';
  import type { Options } from 'roughjs/bin/core';
  import {
    placeTips,
    labelBox,
    separate,
    arrowPaths,
    type Anchors,
    type Rect,
    type Tip,
    type TipId,
    type Bracket,
  } from '../lib/tutorial-layout';

  // Visibility lives in src/stores/tutorial.ts so the global '?' key
  // handler in App.svelte can toggle it. The two dismiss buttons here
  // call the store helpers, which set the relevant flags (session vs
  // persisted) and clear the force-shown flag at the same time.
  //
  // Each tip points at the control it explains wherever that control is
  // right now (lib/tutorial-layout.ts): the overlay measures the controls,
  // places the labels, moves any that would cover each other, then draws
  // the arrows. It does it again whenever the layout changes — window
  // size, tabs moved, shown or hidden, the sidebar pinned, the minimap
  // tucked away — and a control that isn't on screen gets no tip.

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

  const COPY: Record<TipId, string> = {
    menu: 'Open documents and settings here',
    edit: `Edit the text (${formatShortcut('Ctrl+E')})`,
    contents: 'Jump to any section',
    reader: 'Reader mode: nothing but the page',
    tabs: `Your open documents. ${formatShortcut('Ctrl+Shift+B')} hides the tabs`,
    drag: 'Hold to drag the window from here',
    drop: '…or drop a document anywhere in the window',
    minimap: 'Navigate long documents here',
    tools: 'Highlight, write re.marks and draw with these',
    remarks: 'Browse and jump to your re.marks here',
    // Short: in a narrow gap beside the zoom control, clear of the dismiss buttons.
    zoom: 'Text size',
  };

  // The controls, measured. Only what's actually on screen counts.
  function box(sel: string): Rect | undefined {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el || el.getClientRects().length === 0) return undefined;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return undefined;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) return undefined;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }

  // On a Mac the window buttons are the native traffic lights in the
  // top-left corner (tauri.macos.conf.json), outside the page, so there is
  // nothing to measure: this is where they sit.
  const MAC_TRAFFIC_LIGHTS: Rect = { left: 8, top: 8, width: 72, height: 28, right: 80, bottom: 36 };

  function measure(): Anchors {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const active = box('.tabbar [role="tab"][aria-selected="true"]');
    const end = box('.tabbar .new-tab');
    const rows = document.querySelectorAll('.tab-sidebar .side-list > *').length;
    const last = rows ? box(`.tab-sidebar .side-list > :nth-child(${rows})`) : undefined;
    const sidebar = box('.tab-sidebar');
    return {
      window: { width: w, height: h },
      page: box('.scroll') ?? { left: 0, top: 0, right: w, bottom: h, width: w, height: h },
      menu: box('.hamburger'),
      edit: box('.edit-mode-toggle'),
      contents: box('.toc-button'),
      reader: box('.reader-mode-toggle'),
      tabsTop: active && end ? { active, end } : undefined,
      tabsLeft: last && sidebar ? { last, sidebar } : undefined,
      controls: isMac() ? MAC_TRAFFIC_LIGHTS : box('.titlebar-controls'),
      minimap: box('.minimap'),
      tools: box('.rail'),
      remarks: box('.notes-pill-wrap'),
      zoom: box('.zoom-rail'),
    };
  }

  let tips = $state<Tip[]>([]);
  let bracket = $state<Bracket | null>(null);
  // Where each label ended up, once measured and kept apart; null while
  // the labels are being measured (they're laid out but not shown yet).
  let placed = $state<Map<TipId, Rect> | null>(null);
  let arrows = $state<Array<{ line: string; head: string }>>([]);
  const tipEls: Partial<Record<TipId, HTMLElement>> = {};

  async function layout() {
    const a = measure();
    const p = placeTips(a);
    tips = p.tips;
    bracket = p.bracket ?? null;
    placed = null;
    await tick();
    const boxes = tips.map((t) => {
      const el = tipEls[t.id];
      return { id: t.id, nudge: t.nudge, box: labelBox(t, { width: el?.offsetWidth ?? 0, height: el?.offsetHeight ?? 0 }) };
    });
    const dismiss = document.querySelector('.dismiss-stack')?.getBoundingClientRect();
    const obstacles = dismiss && dismiss.width > 0
      ? [{ left: dismiss.left, top: dismiss.top, right: dismiss.right, bottom: dismiss.bottom, width: dismiss.width, height: dismiss.height }]
      : [];
    const out = separate(boxes, a.window, obstacles);
    placed = out;
    arrows = tips.flatMap((t) => (t.point && out.get(t.id) ? [arrowPaths(out.get(t.id)!, t.point)] : []));
  }

  let frame = 0;
  function relayout() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void layout();
    });
  }

  // Lay out on opening, and again whenever the window or the layout moves
  // (the sidebar and minimap slide, so once more after they've settled).
  $effect(() => {
    if (!$tutorialOverlayVisible) return;
    void $settings;
    void $minimapShown;
    relayout();
    const settle = setTimeout(relayout, 380);
    window.addEventListener('resize', relayout);
    const mo = new MutationObserver(relayout);
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => {
      clearTimeout(settle);
      window.removeEventListener('resize', relayout);
      mo.disconnect();
    };
  });

  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame);
  });

  function tipStyle(t: Tip): string {
    const b = placed?.get(t.id);
    if (b) return `left:${b.left}px;top:${b.top}px;`;
    // Measuring: at its position, aligned, but not shown yet.
    const tx = t.alignX === 'left' ? '0' : t.alignX === 'right' ? '-100%' : '-50%';
    const ty = t.alignY === 'top' ? '0' : t.alignY === 'bottom' ? '-100%' : '-50%';
    return `left:${t.at.x}px;top:${t.at.y}px;transform:translate(${tx},${ty});visibility:hidden;`;
  }

  // Arrows and the minimap's bracket are drawn with rough.js: hand-drawn
  // jitter, several slightly offset strokes — the ink-laid-down feel that
  // plain SVG strokes don't have. Redrawn whenever the layout changes.
  const ROUGH_DEFAULTS: Options = {
    stroke: 'currentColor',
    strokeWidth: 2.6,
    roughness: 2.2,
    bowing: 2,
    seed: 42,
  };

  function roughArrows(svg: SVGSVGElement, list: Array<{ line: string; head: string }>) {
    let els: SVGElement[] = [];
    const draw = (items: Array<{ line: string; head: string }>) => {
      els.forEach((el) => el.remove());
      const rc = rough.svg(svg);
      els = items.flatMap((a, i) => [
        rc.path(a.line, { ...ROUGH_DEFAULTS, seed: 42 + i }),
        rc.path(a.head, { ...ROUGH_DEFAULTS, seed: 42 + i, strokeWidth: 1.5, fill: 'currentColor', fillStyle: 'solid' }),
      ]);
      els.forEach((el) => svg.appendChild(el));
    };
    draw(list);
    return {
      update: draw,
      destroy() { els.forEach((el) => el.remove()); },
    };
  }

  // Bracket spine + arms — three short strokes so each gets its own jitter
  // and reads as separate pen strokes laid down in sequence.
  function roughBracket(svg: SVGSVGElement, height: number) {
    let els: SVGElement[] = [];
    const draw = (h: number) => {
      els.forEach((el) => el.remove());
      const rc = rough.svg(svg);
      els = [`M 20,2 L 6,2`, `M 6,2 L 6,${h - 2}`, `M 6,${h - 2} L 20,${h - 2}`].map((d) =>
        rc.path(d, { ...ROUGH_DEFAULTS, strokeWidth: 2.5 }),
      );
      els.forEach((el) => svg.appendChild(el));
    };
    draw(height);
    return { update: draw, destroy() { els.forEach((el) => el.remove()); } };
  }
</script>

{#if $tutorialOverlayVisible}
  <!-- Backdrop is a sibling (NOT a child) of the overlay so the minimap
       (z:85) can stack above the backdrop (z:80) but below the overlay's
       tips (z:90). pointer-events:none keeps every chrome element
       underneath fully clickable through it. -->
  <div class="backdrop" aria-hidden="true"></div>

  <div class="overlay" aria-label="Welcome tutorial">
    <svg class="arrows" aria-hidden="true" use:roughArrows={arrows}></svg>

    {#each tips as t (t.id)}
      <div class="tip" data-tip={t.id} bind:this={tipEls[t.id]} style={tipStyle(t)}>
        {#if t.id === 'drop'}
          <span class="icon" aria-hidden="true"><FileArrowDown size={26} weight="regular" /></span>
        {/if}
        <div class="label">
          {#if t.id === 'tools' || t.id === 'remarks'}
            {COPY[t.id].split('re.marks')[0]}re<span class="brand-dot">.</span>marks{COPY[t.id].split('re.marks')[1]}
          {:else}
            {COPY[t.id]}
          {/if}
        </div>
      </div>
    {/each}

    {#if bracket}
      <div
        class="bracket-row"
        data-tip="minimap"
        style:top={`${bracket.top}px`}
        style:height={`${bracket.bottom - bracket.top}px`}
        style:right={`calc(100vw - ${bracket.x + 24}px)`}
      >
        <div class="bracket-label">{COPY.minimap}</div>
        <svg
          class="bracket"
          viewBox={`0 0 24 ${bracket.bottom - bracket.top}`}
          height={bracket.bottom - bracket.top}
          aria-hidden="true"
          use:roughBracket={bracket.bottom - bracket.top}
        ></svg>
      </div>
    {/if}

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
  /* The tabs stay sharp above the blur, like the minimap: a tip points at
     them. */
  :global(body.tutorial-active .tabbar) {
    z-index: 85;
  }

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

  /* Handwritten tutorial copy (--font-hand, styles/theme.css). Inline
     <code> elements are re-overridden back to monospace below. */
  .label,
  .bracket-label,
  .dismiss-tutorial {
    font-family: var(--font-hand);
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
  .icon {
    color: var(--accent);
    margin-top: 2px;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }
  /* All the arrows, drawn into one sheet over the window. */
  .arrows {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    overflow: visible;
    pointer-events: none;
    color: var(--accent);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }
  .tip {
    align-items: center;
  }
  .tip .label {
    white-space: nowrap;
    max-width: none;
  }
  .label .brand-dot {
    color: var(--accent);
    font-family: var(--font-mono);
  }

  /* The minimap's bracket: alongside it, the label to its left. */
  .bracket-row {
    position: fixed;
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
    width: 24px;
    overflow: visible;
    color: var(--accent);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
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
