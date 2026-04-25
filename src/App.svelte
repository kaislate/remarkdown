<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import './styles/theme.css';
  import './styles/glass.css';
  import './styles/highlights.css';
  import './styles/article.css';
  import Viewer from './components/Viewer.svelte';
  import LeftMarginTitle from './components/LeftMarginTitle.svelte';
  import GlassMenu from './components/GlassMenu.svelte';
  import ToolRail from './components/ToolRail.svelte';
  import ColorStrip from './components/ColorStrip.svelte';
  import OrphanPanel from './components/OrphanPanel.svelte';
  import SettingsModal from './components/SettingsModal.svelte';
  import CorruptSidecarModal from './components/CorruptSidecarModal.svelte';
  import ErrorBanner from './components/ErrorBanner.svelte';
  import Minimap from './components/Minimap.svelte';
  import Splash from './components/Splash.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import Toasts from './components/Toasts.svelte';
  import ZoomControls from './components/ZoomControls.svelte';
  import WelcomeDismiss from './components/WelcomeDismiss.svelte';
  import { refreshRecent, recent, recentExistence, recordRecent, markMissing } from './stores/recent';
  import { loadDocument } from './stores/doc';
  import { welcomeDocPath } from './stores/welcome';
  import { ensureWelcomeDoc } from './lib/tauri-api';
  import { settings, refreshSettings, installSettingsAutosave } from './stores/settings';
  import { installSaveWatcher, savedPulse } from './lib/save';
  import { installFileDropHandler } from './lib/file-drop';
  import { zoomLevel, increaseZoom, decreaseZoom, resetZoom } from './stores/ui';
  import { tool } from './stores/tool';
  import { get } from 'svelte/store';

  let pulse = $state(0);
  savedPulse.subscribe((v) => (pulse = v));

  let disposeSave: (() => void) | null = null;
  let disposeDrop: (() => void) | null = null;
  let disposeSettings: (() => void) | null = null;
  let disposeArticleWidth: (() => void) | null = null;

  // Sync the CSS variable on every zoom change so the root font-size scales
  // and all rem-based article styles (incl. the minimap clone) follow.
  const unsubZoom = zoomLevel.subscribe((z) => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--zoom', String(z));
    }
  });

  // Apply the theme as a data attribute on <html>; theme.css branches on it.
  const unsubTheme = settings.subscribe((s) => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', s.theme);
    }
  });

  // Body-level cursor in eraser mode — the DrawLayer SVG is pointer-events:none
  // in eraser mode, so its CSS cursor doesn't apply. Set the cursor on body
  // instead so the entire canvas reads as "in eraser mode".
  const unsubTool = tool.subscribe((t) => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('eraser-cursor', t.mode === 'eraser');
    }
  });

  function onZoomKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); increaseZoom(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); decreaseZoom(); }
    else if (e.key === '0') { e.preventDefault(); resetZoom(); }
  }

  onMount(async () => {
    // Load persisted settings before anything else so subsequent subscribers
    // (theme, watermark, etc.) see the user's preferences instead of defaults.
    try { await refreshSettings(); } catch { /* fall back to defaults */ }
    disposeSettings = installSettingsAutosave();

    // Apply settings that take effect once at startup. Article width is set
    // as a CSS variable so .text-frame's max-width follows it; default zoom
    // seeds the zoomLevel store (within a session Ctrl+/- can override). The
    // default highlight + ink colours seed the tool store so the next time
    // the user picks the highlight or draw tool they start in their preferred
    // colour rather than the historical preset[0].
    const s = get(settings);
    document.documentElement.style.setProperty('--article-width', `${s.articleWidth}px`);
    zoomLevel.set(s.defaultZoom);
    tool.update((t) => ({
      ...t,
      highlightColor: s.defaultHighlightColor,
      drawColor: s.defaultInkColor,
    }));

    // Keep --article-width in sync when the user changes it from the modal.
    const unsubWidth = settings.subscribe((next) => {
      document.documentElement.style.setProperty('--article-width', `${next.articleWidth}px`);
    });
    disposeArticleWidth = unsubWidth;

    try { await refreshRecent(); } catch { /* ignore on first launch */ }
    disposeSave = installSaveWatcher();
    disposeDrop = await installFileDropHandler();
    window.addEventListener('keydown', onZoomKey);

    // Startup-document precedence:
    //   1. If welcome is enabled (default), materialise it under app_data_dir
    //      and open it. The user gets a guided tour every launch until they
    //      tick the dismiss option.
    //   2. Otherwise, if openLastOnStartup is on, reopen the most recent file.
    //   3. Otherwise, leave the empty state visible.
    if (!s.dontShowWelcomeOnLaunch) {
      try {
        const welcomePath = await ensureWelcomeDoc();
        welcomeDocPath.set(welcomePath);
        await loadDocument(welcomePath);
        await recordRecent(welcomePath);
      } catch {
        // ensure_welcome_doc unavailable (non-Tauri host) — fall through to
        // the openLast branch silently.
      }
    } else if (s.openLastOnStartup) {
      const last = get(recent)[0];
      const exists = last ? get(recentExistence)[last] !== false : false;
      if (last && exists) {
        try {
          await loadDocument(last);
          await recordRecent(last);
        } catch {
          markMissing(last);
        }
      }
    }
  });
  onDestroy(() => {
    disposeSave?.();
    disposeDrop?.();
    disposeSettings?.();
    disposeArticleWidth?.();
    unsubZoom();
    unsubTool();
    unsubTheme();
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onZoomKey);
  });
</script>

<Viewer />
<LeftMarginTitle />
<Minimap />
<TitleBar />
<GlassMenu />
{#if !$settings.hideAnnotationControls}
  <ToolRail />
  <ColorStrip />
{/if}
<ZoomControls />
<WelcomeDismiss />
<OrphanPanel />
<SettingsModal />
<CorruptSidecarModal />
<ErrorBanner />
<Toasts />
{#if import.meta.env.MODE !== 'e2e' && $settings.splashEnabled}
  <Splash />
{/if}

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
