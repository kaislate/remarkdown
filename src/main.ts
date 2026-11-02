// First, so its evaluation marks when the entry chunk starts to run.
import { startupMark } from './lib/startup-trace';
import '@fontsource/patrick-hand/400.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { flushSave } from './lib/save';
import { installE2EBridge } from './lib/e2e-debug-bridge';
import { initPlatform } from './lib/platform';
import { installLinkGuard } from './lib/link-guard';
import { openExternal } from './lib/tauri-api';
import { addToast } from './stores/toasts';
import { startStartupReads } from './lib/startup-reads';

// Settle which OS we're on before the first paint, so shortcuts and chrome
// are right from the start. Settings, recents and reading progress are read
// while that check is out; App picks them up when it mounts.
const platformReady = initPlatform();
startStartupReads(platformReady);
await platformReady;
startupMark('platform-ready');

const app = mount(App, { target: document.getElementById('app')! });
startupMark('app-mounted');

// No link anywhere in the app takes the window with it (lib/link-guard.ts).
installLinkGuard(window, (url) => {
  openExternal(url).catch((err) => {
    addToast({ kind: 'error', message: `Could not open the link: ${String(err)}` });
  });
});

// Flush on window close; Tauri 2.x emits beforeunload through the webview.
// Skip in e2e mode — the handler races with Playwright's page.reload() and
// can cause "Target page, context or browser has been closed" errors.
if (import.meta.env.MODE !== 'e2e') {
  window.addEventListener('beforeunload', () => {
    // Fire-and-forget — the save is debounced so this may already be done.
    flushSave().catch(() => {});
  });
}

installE2EBridge();

export default app;
