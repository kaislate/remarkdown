<script lang="ts" module>
  let nextId = 0;
</script>

<script lang="ts">
  // A small moving picture of reading in reader mode: a page in the
  // theme's own colours scrolling slowly by, and — if shown — the minimap
  // beside it, its box following along. Used by the first-run layout
  // picker. Reduced motion: the resting frame only.
  import { READER_THEME_SWATCHES, type ReaderTheme } from '../../lib/reader-themes';

  interface Props {
    theme: ReaderTheme;
    minimap?: boolean;
    playing?: boolean;
  }
  let { theme, minimap = false, playing = true }: Props = $props();

  const clip = `rsp-clip-${nextId++}`;
  const sw = $derived(READER_THEME_SWATCHES[theme]);
  // Body text: line widths of a ragged paragraph, then a heading, then more.
  const LINES = [
    { h: true, w: 34 }, { w: 58 }, { w: 61 }, { w: 55 }, { w: 60 }, { w: 40 },
    { h: true, w: 28 }, { w: 59 }, { w: 62 }, { w: 52 }, { w: 58 }, { w: 33 },
  ];
  const ROWS = LINES.reduce<{ y: number; w: number; h: boolean }[]>((rows, l) => {
    const prev = rows[rows.length - 1];
    const y = prev ? prev.y + (l.h ? 10 : prev.h ? 8 : 6) : 14;
    rows.push({ y, w: l.w, h: !!l.h });
    return rows;
  }, []);
</script>

<svg
  class="reader-style-preview"
  class:playing
  class:with-map={minimap}
  viewBox="0 0 120 76"
  role="img"
  aria-hidden="true"
  data-theme={theme}
>
  <defs>
    <clipPath id={clip}><rect x="1" y="1" width="118" height="74" rx="6" /></clipPath>
  </defs>
  <g clip-path={`url(#${clip})`}>
    <rect x="0" y="0" width="120" height="76" style:fill={sw.page} />
    <g class="column">
      <g class="lines">
        {#each ROWS as r, i (i)}
          <rect
            x="26"
            y={r.y}
            width={r.h ? r.w * 0.9 : r.w}
            height={r.h ? 4 : 2.4}
            rx={r.h ? 2 : 1.2}
            style:fill={sw.ink}
            opacity={r.h ? 0.95 : 0.6}
          />
        {/each}
      </g>
    </g>
    <g class="map">
      <rect x="99" y="8" width="15" height="60" rx="3" style:fill={sw.ink} opacity="0.07" />
      {#each Array.from({ length: 16 }, (_, i) => 12 + i * 3.4) as y, i (i)}
        <rect x="101.5" y={y} width={[9, 7, 10, 8, 10, 6, 9, 10, 7, 9, 10, 8, 6, 9, 10, 7][i]} height="1" rx="0.5" style:fill={sw.ink} opacity="0.45" />
      {/each}
      <rect class="map-box" x="100" y="10" width="13" height="20" rx="1.5" style:fill={sw.accent} style:stroke={sw.accent} />
    </g>
  </g>
  <rect class="edge" x="0.5" y="0.5" width="119" height="75" rx="6.5" />
</svg>

<style>
  .reader-style-preview {
    display: block;
    width: 100%;
    height: auto;
  }
  .edge {
    fill: none;
    stroke: var(--glass-border);
  }
  /* With the minimap the column moves left a little to make room, as
     reader mode does in a narrow window. */
  .column {
    transition: transform 0.35s ease;
  }
  .with-map .column {
    transform: translateX(-8px);
  }
  .map {
    opacity: 0;
    transform: translateX(10px);
    transition: opacity 0.35s ease, transform 0.35s ease;
  }
  .with-map .map {
    opacity: 1;
    transform: none;
  }
  .map-box {
    fill-opacity: 0.18;
    stroke-opacity: 0.6;
    stroke-width: 0.6;
  }
  /* Reading: the page drifts up and back; the minimap's box follows. */
  .playing .lines {
    animation: rsp-read 7s ease-in-out infinite;
  }
  .playing .map-box {
    animation: rsp-map 7s ease-in-out infinite;
  }
  @keyframes rsp-read {
    0%, 12% { transform: none; }
    50%, 62% { transform: translateY(-34px); }
    100% { transform: none; }
  }
  @keyframes rsp-map {
    0%, 12% { transform: none; }
    50%, 62% { transform: translateY(34px); }
    100% { transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .reader-style-preview *,
    .reader-style-preview {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
