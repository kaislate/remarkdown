<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import './styles/theme.css';
  import './styles/glass.css';
  import './styles/highlights.css';
  import './styles/article.css';
  import './styles/cursors.css';
  import './styles/scrollbars.css';
  import './styles/reader-mode.css';
  import Viewer from './components/Viewer.svelte';
  import LeftMarginTitle from './components/LeftMarginTitle.svelte';
  import WelcomeOverlay from './components/WelcomeOverlay.svelte';
  import GlassMenu from './components/GlassMenu.svelte';
  import ToolRail from './components/ToolRail.svelte';
  import ColorStrip from './components/ColorStrip.svelte';
  import OrphanPanel from './components/OrphanPanel.svelte';
  import SettingsModal from './components/SettingsModal.svelte';
  import ClearAnnotsConfirm from './components/ClearAnnotsConfirm.svelte';
  import UpdateModal from './components/UpdateModal.svelte';
  import CorruptSidecarModal from './components/CorruptSidecarModal.svelte';
  import ErrorBanner from './components/ErrorBanner.svelte';
  import Minimap from './components/Minimap.svelte';
  import Splash from './components/Splash.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import Toasts from './components/Toasts.svelte';
  import ZoomControls from './components/ZoomControls.svelte';
  import ReaderModeToggle from './components/ReaderModeToggle.svelte';
  import NotesPanel from './components/NotesPanel.svelte';
  import WelcomeDismiss from './components/WelcomeDismiss.svelte';
  import { refreshRecent, recent, recentExistence, recordRecent, markMissing } from './stores/recent';
  import { loadDocument } from './stores/doc';
  import { welcomeDocPath } from './stores/welcome';
  import { ensureWelcomeDoc } from './lib/tauri-api';
  import { check as checkForUpdate } from '@tauri-apps/plugin-updater';
  import { addToast } from './stores/toasts';
  import { openModal } from './stores/modals';
  import { settings, refreshSettings, installSettingsAutosave } from './stores/settings';
  import { installSaveWatcher, savedPulse } from './lib/save';
  import { installFileDropHandler } from './lib/file-drop';
  import { zoomLevel, increaseZoom, decreaseZoom, resetZoom } from './stores/ui';
  import { tool, setMode } from './stores/tool';
  import { readerMode, exitReaderMode } from './stores/reader-mode';
  import { toggleTutorial } from './stores/tutorial';
  import type { Tool } from './lib/schema';
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

  // Body-level cursor per active tool. cursors.css branches on these
  // classes; only one is applied at a time so we clear the rest first.
  // (DrawLayer's SVG is pointer-events:none in eraser mode and the layer
  // doesn't cover the whole canvas, so applying the cursor on body is the
  // only way to make every surface read as "in tool X".)
  const TOOL_CURSOR_CLASSES = [
    'cursor-mode-cursor',
    'cursor-mode-highlight',
    'cursor-mode-note',
    'cursor-mode-draw',
    'cursor-mode-eraser',
  ];
  const unsubTool = tool.subscribe((t) => {
    if (typeof document !== 'undefined') {
      document.body.classList.remove(...TOOL_CURSOR_CLASSES);
      document.body.classList.add(`cursor-mode-${t.mode}`);
    }
  });

  // Reflect the reader-mode store on body so reader-mode.css can hide
  // every chrome layer at once. Toggling rather than setting so we
  // don't fight any pre-existing class set by another path.
  const unsubReaderMode = readerMode.subscribe((on) => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('reader-mode', on);
  });

  // ESC exits reader mode. Other ESC handlers (modal close, popover
  // close, menu close) live in their own components and run on the
  // same keydown — that's fine; pressing ESC while a modal is open AND
  // reader mode is on does both, which is what the user expects.
  function onReaderModeEsc(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (!get(readerMode)) return;
    exitReaderMode();
  }

  // '?' toggles the welcome tutorial overlay. Skipped while focus is
  // on a text field so typing '?' inside a re.mark popover writes the
  // character instead of opening the tutorial. ctrl/meta/alt pass
  // through (Ctrl+? is unbound but reserved for future use).
  function onTutorialKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== '?') return;
    const target = e.target as HTMLElement | null;
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    )) return;
    e.preventDefault();
    toggleTutorial();
  }

  function onZoomKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); increaseZoom(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); decreaseZoom(); }
    else if (e.key === '0') { e.preventDefault(); resetZoom(); }
  }

  // Bare-number keys switch the active annotation tool. Skipped while a
  // text input or contenteditable element is focused so typing "1" inside
  // a NotePopover writes the digit instead of swapping to the cursor tool.
  const TOOL_SHORTCUTS: Record<string, Tool> = {
    '1': 'cursor',
    '2': 'highlight',
    '3': 'note',
    '4': 'draw',
    '0': 'eraser',
  };
  // Best-effort silent update check on launch. If an update is found,
  // surface a non-blocking toast with a "View" action that opens the
  // UpdateModal — never auto-install or auto-open the modal.
  async function runBackgroundUpdateCheck(): Promise<void> {
    try {
      const update = await checkForUpdate();
      if (!update) return;
      addToast({
        kind: 'info',
        message: `Update available: v${update.version}`,
        action: {
          label: 'View',
          onClick: () => openModal({ kind: 'check-update' }),
        },
      });
    } catch {
      // Network down, manifest missing, signing problem, non-Tauri host —
      // all silent. Manual "Check for updates…" surfaces specific errors.
    }
  }

  function onToolShortcut(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    )) return;
    const mode = TOOL_SHORTCUTS[e.key];
    if (mode) {
      e.preventDefault();
      setMode(mode);
    }
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
    window.addEventListener('keydown', onToolShortcut);
    window.addEventListener('keydown', onReaderModeEsc);
    window.addEventListener('keydown', onTutorialKey);

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

    // Silent background check for app updates. We deliberately don't
    // await this — the rest of app start happens in parallel — and
    // failures are swallowed so a flaky network never blocks launch.
    if (s.autoCheckForUpdates) {
      void runBackgroundUpdateCheck();
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
    unsubReaderMode();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onZoomKey);
      window.removeEventListener('keydown', onToolShortcut);
      window.removeEventListener('keydown', onReaderModeEsc);
      window.removeEventListener('keydown', onTutorialKey);
    }
  });
</script>

<Viewer />
<LeftMarginTitle />
<WelcomeOverlay />
<Minimap />
<TitleBar />
<GlassMenu />
{#if !$settings.hideAnnotationControls}
  <ToolRail />
  <ColorStrip />
{/if}
<ZoomControls />
<ReaderModeToggle />
<NotesPanel />
<WelcomeDismiss />
<OrphanPanel />
<SettingsModal />
<ClearAnnotsConfirm />
<UpdateModal />
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
