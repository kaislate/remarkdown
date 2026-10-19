<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import './styles/theme.css';
  import './styles/glass.css';
  import './styles/highlights.css';
  import './styles/article.css';
  import './styles/cursors.css';
  import './styles/scrollbars.css';
  import './styles/reader-mode.css';
  import './styles/edit-mode.css';
  import './styles/tabs-layout.css';
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
  import EditConflictModal from './components/EditConflictModal.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import ErrorBanner from './components/ErrorBanner.svelte';
  import Minimap from './components/Minimap.svelte';
  import Splash from './components/Splash.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import TabBar from './components/TabBar.svelte';
  import MouseCursor from './components/MouseCursor.svelte';
  import Toasts from './components/Toasts.svelte';
  import ZoomControls from './components/ZoomControls.svelte';
  import EditModeToggle from './components/EditModeToggle.svelte';
  import ReaderModeToggle from './components/ReaderModeToggle.svelte';
  import ReaderModeLayer from './components/ReaderModeLayer.svelte';
  import ReaderMeta from './components/ReaderMeta.svelte';
  import { doc } from './stores/doc';
  import TocButton from './components/TocButton.svelte';
  import NotesPanel from './components/NotesPanel.svelte';
  import WelcomeDismiss from './components/WelcomeDismiss.svelte';
  import ReattachBanner from './components/ReattachBanner.svelte';
  import { refreshRecent, recent, recentExistence, markMissing } from './stores/recent';
  import { openPaths, drainPendingOpens } from './lib/open-files';
  import { runBeforeSwitch, activateSession } from './stores/tabs';
  import { restoreSavedTabs, installSessionAutosave, flushSessionNow } from './stores/session-persist';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { welcomeDocPath } from './stores/welcome';
  import { ensureWelcomeDoc, onOpenRequested } from './lib/tauri-api';
  import { check as checkForUpdate } from '@tauri-apps/plugin-updater';
  import { addToast } from './stores/toasts';
  import { availableUpdate } from './stores/updates';
  import { openModal, activeModal } from './stores/modals';
  import { savesSettled, unresolvedConflict, askAboutConflict } from './lib/edit-save';
  import { sessions, activeSession } from './stores/sessions';
  import { settings, refreshSettings, installSettingsAutosave } from './stores/settings';
  import { refreshReadingProgress } from './stores/reading-progress';
  import { installSaveWatcher, savedPulse } from './lib/save';
  import { installFileDropHandler } from './lib/file-drop';
  import { zoomLevel, increaseZoom, decreaseZoom, resetZoom } from './stores/ui';
  import { tool, setMode } from './stores/tool';
  import { readerMode, installReaderMode } from './stores/reader-mode';
  import { reattachTarget, cancelReattach } from './stores/reattach';
  import { toggleTutorial } from './stores/tutorial';
  import { editMode, toggleEditMode } from './stores/edit-mode';
  import type { Tool } from './lib/schema';
  import { get } from 'svelte/store';

  let pulse = $state(0);
  savedPulse.subscribe((v) => (pulse = v));

  let disposeSave: (() => void) | null = null;
  let disposeDrop: (() => void) | null = null;
  let disposeSettings: (() => void) | null = null;
  let disposeArticleWidth: (() => void) | null = null;
  let disposeOpenRequested: (() => void) | null = null;
  let disposeCloseRequested: (() => void) | null = null;
  let disposeSessionAutosave: (() => void) | null = null;

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

  // Reader mode (body class + reader theme, Esc to leave, read-only
  // annotation tools) — see stores/reader-mode.ts.
  const disposeReaderMode = installReaderMode();

  // Reflect the edit-mode store on body so edit-mode.css can hide
  // annotation layers and apply edit mode styling.
  const unsubEditMode = editMode.subscribe((on) => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('edit-mode', on);
  });

  // ESC cancels an in-progress re-attach operation. In reader mode that
  // Esc only cancels the re-attach — leaving reader mode takes a second
  // Esc (stores/reader-mode.ts checks for an open layer first).
  function onReattachEsc(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (!get(reattachTarget)) return;
    cancelReattach();
  }

  // '?' toggles the welcome tutorial overlay. Skipped while focus is
  // on a text field so typing '?' inside a re.mark popover writes the
  // character instead of opening the tutorial. ctrl/meta/alt pass
  // through (Ctrl+? is unbound but reserved for future use).
  function onTutorialKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== '?') return;
    // The tutorial points at chrome reader mode has hidden.
    if (get(readerMode)) return;
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

  function onEditModeKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key !== 'e' && e.key !== 'E') return;
    // Reader mode is for reading; Esc first, then edit.
    if (get(readerMode)) return;
    // Not while a dialog is open (e.g. deciding about an edit conflict).
    if (get(activeModal)) return;
    // Skip while a text input or contenteditable is focused — typing
    // Cmd+E inside a re.mark popover etc. shouldn't toggle the editor.
    const target = e.target as HTMLElement | null;
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    )) return;
    e.preventDefault();
    toggleEditMode();
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
      // Persist the "update available" signal for the session so the
      // hamburger menu can flip its "Check for updates…" item into a
      // styled "Update available — vX" affordance.
      availableUpdate.set({ version: update.version });
      addToast({
        kind: 'info',
        message: `Update available: v${update.version}`,
        action: {
          label: 'View changes',
          onClick: () => openModal({ kind: 'check-update' }),
        },
        // Don't auto-dismiss — the user should see this until they
        // either install the update or explicitly click ×.
        persistent: true,
      });
    } catch {
      // Network down, manifest missing, signing problem, non-Tauri host —
      // all silent. Manual "Check for updates…" surfaces specific errors.
    }
  }

  function onToolShortcut(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Annotations are read-only in reader mode (the tool is parked on
    // cursor — see stores/reader-mode.ts).
    if (get(readerMode)) return;
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
    try { await refreshReadingProgress(); } catch { /* ignore */ }
    disposeSave = installSaveWatcher();
    disposeDrop = await installFileDropHandler();
    window.addEventListener('keydown', onZoomKey);
    window.addEventListener('keydown', onToolShortcut);
    window.addEventListener('keydown', onReattachEsc);
    window.addEventListener('keydown', onTutorialKey);
    window.addEventListener('keydown', onEditModeKey);

    // Files the OS hands us later (double-click while we're running) arrive
    // as 'open-requested'. Listen before the first drain below so nothing
    // queued in between can be missed.
    disposeOpenRequested = await onOpenRequested(() => { void drainPendingOpens(); });

    // Flush the active tab's pending saves before the window goes away.
    try {
      // Registering this handler hands the close to JS: Tauri then calls
      // destroy() once it resolves (needs core:window:allow-destroy). Never
      // let a failed flush keep the window open.
      disposeCloseRequested = await getCurrentWindow().onCloseRequested(async (event) => {
        try {
          await runBeforeSwitch();
          await Promise.all(get(sessions).map((s) => savesSettled(s)));
          // Edits waiting on a "changed by another program" decision would
          // be lost: keep the window open and ask instead.
          const waiting = unresolvedConflict();
          if (waiting) {
            event.preventDefault();
            if (get(activeSession) !== waiting) await activateSession(waiting.id);
            askAboutConflict(waiting);
            return;
          }
          await flushSessionNow();
        } catch (err) {
          console.error('[remarkdown] flush on close failed:', err);
        }
      });
    } catch {
      // non-Tauri host
    }

    // Startup-document precedence:
    //   0. A window opened in "new window per file" mode shows its file only.
    //   1. Tabs mode: reopen the previous session's tabs (if enabled), then
    //      add files we were launched with (double-click / Open with). These win
    //      over welcome — the user asked for that file (#24).
    //   2. Otherwise, if welcome is enabled (default), open it. The user gets
    //      a guided tour every launch until they tick the dismiss option.
    //   3. Otherwise, outside tabs mode, openLastOnStartup reopens the most
    //      recent file.
    //   4. Otherwise, leave the empty state visible.
    const presetPath = (window as unknown as { __RMD_OPEN__?: string }).__RMD_OPEN__;
    if (presetPath) {
      await openPaths([presetPath]);
    } else {
      if (s.openMode === 'tabs' && s.reopenTabsOnLaunch) await restoreSavedTabs();
      const launched = await drainPendingOpens();
      if (launched === 0) {
        if (!s.dontShowWelcomeOnLaunch) {
          try {
            const welcomePath = await ensureWelcomeDoc();
            welcomeDocPath.set(welcomePath);
            await openPaths([welcomePath]);
          } catch {
            // ensure_welcome_doc unavailable (non-Tauri host) — stay empty.
          }
        } else if (s.openLastOnStartup && s.openMode !== 'tabs') {
          const last = get(recent)[0];
          const exists = last ? get(recentExistence)[last] !== false : false;
          if (last && exists) {
            if ((await openPaths([last])) === 0) markMissing(last);
          }
        }
      }
    }

    // "How do you want to use remarkdown?" — once, in the main window, for
    // everyone who hasn't answered it: new installs, and everyone updating
    // to 0.8, the version that introduced it (earlier versions never wrote
    // onboardingCompleted). It's in Settings → About after that.
    if (!presetPath && !get(settings).onboardingCompleted) {
      openModal({ kind: 'onboarding' });
    }

    // Remember open tabs for next launch (main window, tabs mode). Installed
    // after the startup opens so restoring doesn't trigger a rewrite storm.
    disposeSessionAutosave = installSessionAutosave();

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
    disposeOpenRequested?.();
    disposeCloseRequested?.();
    disposeSessionAutosave?.();
    unsubZoom();
    unsubTool();
    unsubTheme();
    disposeReaderMode();
    unsubEditMode();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onZoomKey);
      window.removeEventListener('keydown', onToolShortcut);
      window.removeEventListener('keydown', onReattachEsc);
      window.removeEventListener('keydown', onTutorialKey);
      window.removeEventListener('keydown', onEditModeKey);
    }
  });
</script>

<Viewer />
<LeftMarginTitle />
<WelcomeOverlay />
<Minimap />
<TitleBar />
<TabBar />
<MouseCursor />
<ReattachBanner />
<GlassMenu />
{#if !$settings.hideAnnotationControls}
  <ToolRail />
  <ColorStrip />
{/if}
<ZoomControls />
<ReaderModeToggle />
<ReaderModeLayer />
{#if $readerMode && !$editMode && $doc}
  <ReaderMeta />
{/if}
<EditModeToggle />
<TocButton />
<NotesPanel />
<WelcomeDismiss />
<OrphanPanel />
<SettingsModal />
<ClearAnnotsConfirm />
<UpdateModal />
<CorruptSidecarModal />
<EditConflictModal />
<Onboarding />
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
