<script lang="ts">
  import { onMount } from 'svelte';
  import './styles/theme-dark.css';
  import './styles/glass.css';
  import './styles/highlights.css';
  import Viewer from './components/Viewer.svelte';
  import GlassMenu from './components/GlassMenu.svelte';
  import { refreshRecent } from './stores/recent';

  onMount(async () => {
    try { await refreshRecent(); } catch { /* ignore on first launch */ }
  });
</script>

<Viewer />
<GlassMenu />
