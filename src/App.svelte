<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import './styles/theme-dark.css';
  import './styles/glass.css';
  import './styles/highlights.css';
  import Viewer from './components/Viewer.svelte';
  import GlassMenu from './components/GlassMenu.svelte';
  import ToolRail from './components/ToolRail.svelte';
  import ColorStrip from './components/ColorStrip.svelte';
  import OrphanPanel from './components/OrphanPanel.svelte';
  import CorruptSidecarModal from './components/CorruptSidecarModal.svelte';
  import Toasts from './components/Toasts.svelte';
  import { refreshRecent } from './stores/recent';
  import { installSaveWatcher, savedPulse } from './lib/save';

  let pulse = $state(0);
  savedPulse.subscribe((v) => (pulse = v));

  let disposeSave: (() => void) | null = null;
  onMount(async () => {
    try { await refreshRecent(); } catch { /* ignore on first launch */ }
    disposeSave = installSaveWatcher();
  });
  onDestroy(() => { disposeSave?.(); });
</script>

<Viewer />
<GlassMenu />
<ToolRail />
<ColorStrip />
<OrphanPanel />
<CorruptSidecarModal />
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
