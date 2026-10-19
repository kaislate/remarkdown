<script lang="ts">
  // Small animated pictures of what each setting does (112×70). At rest a
  // scene shows its end state; while `playing` (hover, focus, or just
  // after the value changed) it runs a short loop. Scenes that depend on
  // the value (colours, widths, modes) read it from `value`. Reduced
  // motion: no animation, the resting frame only.
  interface Props {
    name: string;
    playing?: boolean;
    value?: unknown;
  }
  let { name, playing = false, value }: Props = $props();

  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const bool = (v: unknown) => v === true;
</script>

<svg
  class="depiction"
  class:playing
  viewBox="0 0 112 70"
  role="img"
  aria-hidden="true"
  data-depiction={name}
>
  <rect class="ground" x="0.5" y="0.5" width="111" height="69" rx="6" />

  {#if name === 'theme'}
    <g class="theme-light"><rect x="10" y="10" width="92" height="50" rx="4" class="lightpage" />
      <rect x="20" y="22" width="50" height="3" rx="1.5" class="lightink" /><rect x="20" y="30" width="62" height="3" rx="1.5" class="lightink" /><rect x="20" y="38" width="44" height="3" rx="1.5" class="lightink" /></g>
    <g class="theme-dark" class:right={str(value, 'dark') === 'light'}><rect x="10" y="10" width="92" height="50" rx="4" class="darkpage" />
      <rect x="20" y="22" width="50" height="3" rx="1.5" class="darkink" /><rect x="20" y="30" width="62" height="3" rx="1.5" class="darkink" /><rect x="20" y="38" width="44" height="3" rx="1.5" class="darkink" /></g>

  {:else if name === 'splash'}
    <text x="56" y="41" text-anchor="middle" class="logo">re<tspan class="acc">.</tspan>md</text>

  {:else if name === 'watermark' || name === 'watermark-opacity'}
    <rect x="34" y="14" width="56" height="3" rx="1.5" class="ln" /><rect x="34" y="22" width="48" height="3" rx="1.5" class="ln" /><rect x="34" y="30" width="54" height="3" rx="1.5" class="ln" /><rect x="34" y="38" width="40" height="3" rx="1.5" class="ln" /><rect x="34" y="46" width="50" height="3" rx="1.5" class="ln" />
    <text
      x="20" y="35" class="wm" text-anchor="middle" transform="rotate(-90 20 35)"
      style:opacity={name === 'watermark-opacity' ? Math.min(1, num(value, 0.08) * 4 + 0.08) : 0.35}
    >NOTES</text>

  {:else if name === 'zoom'}
    <g class="zoom" style:transform={`scale(${num(value, 1)})`}>
      <text x="56" y="34" text-anchor="middle" class="big">Aa</text>
      <rect x="30" y="42" width="52" height="3" rx="1.5" class="ln" /><rect x="34" y="49" width="44" height="3" rx="1.5" class="ln" />
    </g>

  {:else if name === 'width'}
    {@const w = 24 + ((num(value, 720) - 480) / 720) * 64}
    <g class="width" style:--w={`${w}px`}>
      {#each [16, 24, 32, 40, 48] as y (y)}
        <rect x={56 - w / 2} y={y} width={w} height="3" rx="1.5" class="ln col" />
      {/each}
    </g>

  {:else if name === 'reader'}
    <rect x="0.5" y="0.5" width="111" height="11" class="chrome fadechrome" />
    <circle cx="8" cy="6" r="2" class="chromedot fadechrome" /><circle cx="104" cy="6" r="2" class="chromedot fadechrome" />
    {#each [20, 28, 36, 44, 52] as y, i (y)}
      <rect x="28" y={y} width={[56, 50, 54, 44, 52][i]} height="3" rx="1.5" class="ln" />
    {/each}

  {:else if name === 'open-mode'}
    {@const mode = str(value, 'tabs')}
    <rect x="8" y="8" width="96" height="54" rx="4" class="page" />
    <rect x="8" y="8" width="96" height="10" rx="4" class="chrome" />
    {#if mode === 'tabs'}
      <rect x="14" y="11" width="24" height="7" rx="2" class="tab" /><rect x="40" y="11" width="24" height="7" rx="2" class="tab active newtab" />
    {:else if mode === 'replace'}
      <rect x="14" y="11" width="24" height="7" rx="2" class="tab active" />
      <g class="swap"><rect x="22" y="26" width="60" height="3" rx="1.5" class="ln" /><rect x="22" y="34" width="50" height="3" rx="1.5" class="ln" /><rect x="22" y="42" width="56" height="3" rx="1.5" class="ln" /></g>
    {:else}
      <g class="newwin"><rect x="46" y="24" width="56" height="40" rx="4" class="page raised" /><rect x="46" y="24" width="56" height="8" rx="4" class="chrome" /></g>
    {/if}

  {:else if name === 'restore'}
    <rect x="8" y="8" width="96" height="54" rx="4" class="page" />
    <rect x="8" y="8" width="96" height="10" rx="4" class="chrome" />
    <rect x="14" y="11" width="22" height="7" rx="2" class="tab pop1" /><rect x="38" y="11" width="22" height="7" rx="2" class="tab active pop2" /><rect x="62" y="11" width="22" height="7" rx="2" class="tab pop3" />

  {:else if name === 'default-app'}
    <g class="file"><path d="M24 14h20l8 8v30H24z" class="filebody" /><path d="M44 14v8h8" class="filefold" /><text x="38" y="44" text-anchor="middle" class="ext">.md</text></g>
    <circle cx="38" cy="34" r="10" class="ripple" />
    <g class="openwin"><rect x="62" y="18" width="40" height="34" rx="3" class="page raised" /><rect x="62" y="18" width="40" height="7" rx="3" class="chrome" /><rect x="68" y="31" width="26" height="2.5" rx="1.25" class="ln" /><rect x="68" y="37" width="22" height="2.5" rx="1.25" class="ln" /></g>

  {:else if name === 'welcome'}
    <text x="56" y="30" text-anchor="middle" class="hello">Welcome</text>
    <rect x="30" y="38" width="52" height="3" rx="1.5" class="ln" /><rect x="34" y="45" width="44" height="3" rx="1.5" class="ln" />

  {:else if name === 'tutorial'}
    <rect x="18" y="16" width="44" height="3" rx="1.5" class="ln" /><rect x="18" y="24" width="38" height="3" rx="1.5" class="ln" /><rect x="18" y="32" width="42" height="3" rx="1.5" class="ln" />
    <path d="M90 50 C 84 38, 74 34, 64 30" class="hand draw" /><path d="M64 30 l6 -1 M64 30 l3 5" class="hand draw" />

  {:else if name === 'recent'}
    {#each [0, 1, 2, 3] as i (i)}
      <g class="recentrow" style:--i={i}><rect x="20" y={14 + i * 11} width="8" height="8" rx="2" class="chip" /><rect x="32" y={16.5 + i * 11} width={46 - i * 6} height="3" rx="1.5" class="ln" /></g>
    {/each}

  {:else if name === 'autosave'}
    <rect x="18" y="22" width="60" height="3" rx="1.5" class="ln" /><rect x="18" y="30" width="44" height="3" rx="1.5" class="ln" />
    <rect x="18" y="29" width="30" height="5" rx="1" class="hlmark" style:--c={'rgba(255,210,90,.6)'} />
    <g class="saved"><circle cx="88" cy="45" r="8" class="okring" /><path d="M84 45 l3 3 l5 -6" class="ok" /></g>

  {:else if name === 'tools'}
    <rect x="22" y="14" width="68" height="3" rx="1.5" class="ln" /><rect x="22" y="22" width="56" height="3" rx="1.5" class="ln" /><rect x="22" y="30" width="62" height="3" rx="1.5" class="ln" />
    <g class="rail" class:off={bool(value)}><rect x="30" y="46" width="52" height="14" rx="7" class="railbg" />
      {#each [40, 51, 62, 73] as x (x)}<circle cx={x} cy="53" r="3" class="railbtn" />{/each}</g>

  {:else if name === 'highlight-color' || name === 'ink-color'}
    {@const c = str(value, name === 'ink-color' ? '#8b7fff' : '#ffd25a')}
    <rect x="18" y="24" width="76" height="3" rx="1.5" class="ln" /><rect x="18" y="34" width="64" height="3" rx="1.5" class="ln" /><rect x="18" y="44" width="70" height="3" rx="1.5" class="ln" />
    {#if name === 'highlight-color'}
      <rect x="18" y="31.5" width="64" height="8" rx="1.5" class="sweep" style:fill={c} style:opacity="0.55" />
    {:else}
      <path d="M16 52 C 34 38, 56 60, 92 30" class="stroke draw" style:stroke={c} />
    {/if}

  {:else if name === 're-context' || name === 're-paragraph' || name === 're-listitem'}
    {#if name === 're-listitem'}
      {#each [16, 28, 40, 52] as y, i (y)}
        <circle cx="22" cy={y + 1.5} r="2" class="bullet" />
        <rect x="28" y={y} width={[56, 48, 60, 40][i]} height="3" rx="1.5" class="ln" class:ctx={i === 1} />
      {/each}
    {:else}
      {@const n = name === 're-context' ? Math.round(num(value, 1)) : 2}
      {#each [14, 21, 28, 35, 42, 49, 56] as y, i (y)}
        <rect x="16" y={y} width={[70, 74, 60, 72, 66, 70, 52][i]} height="3" rx="1.5" class="ln"
          class:ctx={Math.abs(i - 3) <= Math.floor((n - 1) / 2) + (i > 3 && (n - 1) % 2 ? 1 : 0) && !(name === 're-paragraph' && i < 2)} />
      {/each}
      {#if name === 're-paragraph'}<rect x="12" y="25" width="88" height="1" class="boundary" />{/if}
    {/if}
    <circle cx="96" cy="37" r="5" class="remark" />

  {:else if name === 'marginalia'}
    <rect x="12" y="16" width="56" height="3" rx="1.5" class="ln" /><rect x="12" y="24" width="50" height="3" rx="1.5" class="ln" /><rect x="12" y="32" width="54" height="3" rx="1.5" class="ln" /><rect x="12" y="40" width="46" height="3" rx="1.5" class="ln" />
    <rect x="76" y="14" width="26" height="14" rx="3" class="card slide1" /><rect x="76" y="34" width="26" height="14" rx="3" class="card slide2" />

  {:else if name === 'shapes'}
    <path d="M56 18 C 72 16, 78 30, 74 40 C 70 52, 44 54, 38 42 C 33 31, 42 19, 58 20" class="stroke wobbly" />
    <ellipse cx="56" cy="35" rx="19" ry="17" class="stroke clean" />

  {:else if name === 'roughness'}
    {@const r = num(value, 1.4)}
    <path
      d={`M14 ${35 - r * 2} Q 28 ${35 + r * 4} 42 ${35 - r * 3} T 70 ${35 + r * 3} T 98 ${35 - r * 2}`}
      class="stroke draw"
    />
    <path d={`M14 ${36 + r} Q 34 ${34 - r * 2} 56 ${36 + r * 2} T 98 ${35 + r}`} class="stroke faint draw" />

  {:else if name === 'draw-idle'}
    <path d="M22 44 l14 -14" class="stroke draw" /><path d="M40 44 l14 -14" class="stroke draw d2" />
    <circle cx="82" cy="36" r="10" class="timer" />

  {:else if name === 'confidence'}
    <ellipse cx="46" cy="36" rx="20" ry="16" class="stroke" />
    <rect x="68" y="16" width="30" height="13" rx="6.5" class="badge" /><text x="83" y="25.5" text-anchor="middle" class="badgetext">92%</text>

  {:else if name === 'updates' || name === 'prerelease'}
    <rect x="34" y="40" width="44" height="14" rx="3" class="tray" />
    <path d="M56 14 v20 M48 26 l8 8 l8 -8" class="arrow" />
    {#if name === 'prerelease'}<rect x="70" y="12" width="28" height="12" rx="6" class="beta" /><text x="84" y="20.5" text-anchor="middle" class="betatext">beta</text>{/if}
  {/if}
</svg>

<style>
  .depiction {
    display: block;
    width: 112px;
    height: 70px;
    flex: 0 0 auto;
  }
  .ground { fill: var(--bg-1); stroke: var(--glass-border); }
  .ln { fill: var(--fg-2); opacity: 0.45; }
  .ln.ctx { fill: var(--accent); opacity: 0.8; }
  .page { fill: var(--bg-0); stroke: var(--glass-border); }
  .page.raised { filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.3)); }
  .chrome { fill: var(--bg-2); }
  .chromedot { fill: var(--fg-2); opacity: 0.6; }
  .tab { fill: var(--glass-fill); stroke: var(--glass-border); }
  .tab.active { fill: var(--accent-soft); stroke: var(--accent); }
  .chip { fill: var(--accent-soft); }
  .logo { font: 700 16px var(--font-sans); fill: var(--fg-0); }
  .acc { fill: var(--accent); }
  .wm { font: 700 13px var(--font-sans); fill: var(--fg-1); letter-spacing: 1px; }
  .big { font: 600 16px var(--font-serif); fill: var(--fg-0); }
  .zoom { transform-origin: 56px 38px; transition: transform 0.3s ease; }
  .hello { font: 600 13px var(--font-serif); fill: var(--fg-0); }
  .hand { fill: none; stroke: var(--accent); stroke-width: 1.6; stroke-linecap: round; }
  .filebody { fill: var(--bg-0); stroke: var(--fg-2); }
  .filefold { fill: none; stroke: var(--fg-2); }
  .ext { font: 600 8px var(--font-sans); fill: var(--accent); }
  .ripple { fill: none; stroke: var(--accent); opacity: 0; }
  .hlmark { fill: var(--c); }
  .okring { fill: none; stroke: #4cc38a; }
  .ok { fill: none; stroke: #4cc38a; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .railbg { fill: var(--glass-fill); stroke: var(--glass-border); }
  .railbtn { fill: var(--fg-2); }
  .rail { transition: transform 0.4s ease, opacity 0.4s ease; }
  .rail.off { transform: translateY(16px); opacity: 0; }
  .stroke { fill: none; stroke: var(--accent); stroke-width: 1.6; stroke-linecap: round; }
  .stroke.faint { opacity: 0.4; }
  .bullet { fill: var(--fg-2); }
  .remark { fill: var(--accent); opacity: 0.85; }
  .boundary { fill: var(--accent); opacity: 0.6; }
  .card { fill: var(--accent-soft); stroke: var(--glass-border); }
  .timer { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 63; stroke-dashoffset: 0; transform: rotate(-90deg); transform-origin: 82px 36px; }
  .badge { fill: var(--accent-soft); stroke: var(--accent); }
  .badgetext { font: 600 8px var(--font-sans); fill: var(--fg-0); }
  .tray { fill: none; stroke: var(--fg-2); }
  .arrow { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .beta { fill: var(--accent-soft); stroke: var(--accent); }
  .betatext { font: 600 7px var(--font-sans); fill: var(--fg-0); }
  .lightpage { fill: #faf8f3; } .lightink { fill: #4a4658; opacity: 0.6; }
  .darkpage { fill: #0b0a12; } .darkink { fill: #b7b4c7; opacity: 0.6; }
  .theme-dark { clip-path: inset(0 0 0 50%); transition: clip-path 0.5s ease; }
  .theme-dark.right { clip-path: inset(0 0 0 100%); }
  .col { transition: width 0.3s ease, x 0.3s ease; }

  /* ---- motion: only while playing ---- */
  .playing .theme-dark { animation: wipe 2.4s ease-in-out infinite; }
  @keyframes wipe { 0%, 100% { clip-path: inset(0 0 0 0); } 50% { clip-path: inset(0 0 0 100%); } }
  .playing .logo { animation: splash 2.4s ease-in-out infinite; transform-origin: 56px 36px; }
  @keyframes splash { 0% { opacity: 0; transform: scale(0.8); } 30%, 70% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.05); } }
  .playing .wm { animation: fadein 2.4s ease-in-out infinite; }
  @keyframes fadein { 0% { opacity: 0; } 40%, 80% { opacity: 0.5; } 100% { opacity: 0; } }
  .playing .zoom { animation: zoompulse 2.4s ease-in-out infinite; }
  @keyframes zoompulse { 0%, 100% { transform: scale(0.85); } 50% { transform: scale(1.15); } }
  .playing .fadechrome { animation: fadechrome 2.6s ease-in-out infinite; }
  @keyframes fadechrome { 0%, 25% { opacity: 1; transform: none; } 50%, 85% { opacity: 0; transform: translateY(-8px); } 100% { opacity: 1; } }
  .playing .newtab { animation: growtab 2.2s ease-in-out infinite; transform-origin: 40px 14px; }
  @keyframes growtab { 0% { transform: scaleX(0); } 30%, 100% { transform: scaleX(1); } }
  .playing .swap { animation: swap 2.2s ease-in-out infinite; }
  @keyframes swap { 0%, 100% { opacity: 1; } 40%, 60% { opacity: 0; transform: translateX(-6px); } }
  .playing .newwin { animation: popwin 2.2s ease-out infinite; transform-origin: 74px 44px; }
  @keyframes popwin { 0% { transform: scale(0.6); opacity: 0; } 30%, 100% { transform: scale(1); opacity: 1; } }
  .playing .pop1, .playing .pop2, .playing .pop3 { animation: popin 2.4s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  .playing .pop2 { animation-delay: 0.2s; } .playing .pop3 { animation-delay: 0.4s; }
  @keyframes popin { 0% { transform: scale(0); opacity: 0; } 25%, 100% { transform: scale(1); opacity: 1; } }
  .playing .ripple { animation: ripple 2.2s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes ripple { 0% { opacity: 0.8; transform: scale(0.3); } 50%, 100% { opacity: 0; transform: scale(1.4); } }
  .playing .openwin { animation: popwin 2.2s ease-out infinite; animation-delay: 0.3s; transform-origin: 82px 35px; }
  .playing .hello { animation: splash 2.4s ease-in-out infinite; transform-origin: 56px 26px; }
  .draw { stroke-dasharray: 160; stroke-dashoffset: 0; }
  .playing .draw { animation: draw 2.4s ease-in-out infinite; }
  .playing .draw.d2 { animation-delay: 0.3s; }
  @keyframes draw { 0% { stroke-dashoffset: 160; } 50%, 100% { stroke-dashoffset: 0; } }
  .playing .recentrow { animation: slidein 2.4s ease-out infinite; animation-delay: calc(var(--i) * 0.15s); }
  @keyframes slidein { 0% { opacity: 0; transform: translateY(-4px); } 25%, 100% { opacity: 1; transform: none; } }
  .playing .saved { animation: saved 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes saved { 0%, 45% { opacity: 0; transform: scale(0.6); } 60%, 100% { opacity: 1; transform: scale(1); } }
  .playing .rail:not(.off) { animation: railup 2.4s ease-out infinite; }
  @keyframes railup { 0% { transform: translateY(16px); opacity: 0; } 30%, 100% { transform: none; opacity: 1; } }
  .sweep { transform-box: fill-box; transform-origin: left center; }
  .playing .sweep { animation: sweep 2.4s ease-in-out infinite; }
  @keyframes sweep { 0% { transform: scaleX(0); } 45%, 100% { transform: scaleX(1); } }
  .playing .ln.ctx { animation: ctxpulse 2.4s ease-in-out infinite; }
  @keyframes ctxpulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }
  .playing .slide1, .playing .slide2 { animation: slidecard 2.4s ease-out infinite; }
  .playing .slide2 { animation-delay: 0.25s; }
  @keyframes slidecard { 0% { transform: translateX(20px); opacity: 0; } 30%, 100% { transform: none; opacity: 1; } }
  .clean { opacity: 0; }
  .playing .wobbly { animation: morphout 2.6s ease-in-out infinite; }
  .playing .clean { animation: morphin 2.6s ease-in-out infinite; }
  @keyframes morphout { 0%, 40% { opacity: 1; } 55%, 100% { opacity: 0; } }
  @keyframes morphin { 0%, 40% { opacity: 0; } 55%, 100% { opacity: 1; } }
  .playing .timer { animation: timer 2.4s linear infinite; }
  @keyframes timer { from { stroke-dashoffset: 63; } to { stroke-dashoffset: 0; } }
  .playing .badge, .playing .beta { animation: ctxpulse 2.4s ease-in-out infinite; }
  .playing .arrow { animation: drop 2.2s ease-in-out infinite; }
  @keyframes drop { 0% { transform: translateY(-6px); opacity: 0; } 40%, 100% { transform: none; opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .depiction *, .depiction { animation: none !important; transition: none !important; }
  }
</style>
