<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import './styles/theme-dark.css';
  import './styles/glass.css';
  import './styles/highlights.css';
  import './styles/article.css';
  import Viewer from './components/Viewer.svelte';
  import GlassMenu from './components/GlassMenu.svelte';
  import ToolRail from './components/ToolRail.svelte';
  import ColorStrip from './components/ColorStrip.svelte';
  import OrphanPanel from './components/OrphanPanel.svelte';
  import CorruptSidecarModal from './components/CorruptSidecarModal.svelte';
  import ErrorBanner from './components/ErrorBanner.svelte';
  import Minimap from './components/Minimap.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import Toasts from './components/Toasts.svelte';
  import ZoomControls from './components/ZoomControls.svelte';
  import { refreshRecent } from './stores/recent';
  import { installSaveWatcher, savedPulse } from './lib/save';
  import { zoomLevel, increaseZoom, decreaseZoom, resetZoom } from './stores/ui';

  let pulse = $state(0);
  savedPulse.subscribe((v) => (pulse = v));

  let disposeSave: (() => void) | null = null;

  // Sync the CSS variable on every zoom change so the root font-size scales
  // and all rem-based article styles (incl. the minimap clone) follow.
  const unsubZoom = zoomLevel.subscribe((z) => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--zoom', String(z));
    }
  });

  function onZoomKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); increaseZoom(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); decreaseZoom(); }
    else if (e.key === '0') { e.preventDefault(); resetZoom(); }
  }

  onMount(async () => {
    try { await refreshRecent(); } catch { /* ignore on first launch */ }
    disposeSave = installSaveWatcher();
    window.addEventListener('keydown', onZoomKey);
  });
  onDestroy(() => {
    disposeSave?.();
    unsubZoom();
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onZoomKey);
  });
</script>

<Viewer />
<Minimap />
<TitleBar />
<GlassMenu />
<ToolRail />
<ColorStrip />
<ZoomControls />
<OrphanPanel />
<CorruptSidecarModal />
<ErrorBanner />
<Toasts />

{#if pulse > 0}
  {#key pulse}
    <div class="saved-pulse" aria-live="polite">saved</div>
  {/key}
{/if}

<style>
  .saved-pulse {
    position: fixed;
    top: 18px;
    left: 64px;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--fg-2);
    letter-spacing: 0.04em;
    animation: pulse 1.4s ease-out forwards;
    z-index: 90;
  }
  @keyframes pulse {
    0%   { opacity: 0; transform: translateY(-4px); }
    25%  { opacity: 1; transform: translateY(0); }
    75%  { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
