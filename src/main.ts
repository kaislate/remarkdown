// First, so its evaluation marks when the entry chunk starts to run.
import { startupMark } from './lib/startup-trace';
import '@fontsource/patrick-hand/400.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { flushSave } from './lib/save';
import { installE2EBridge } from './lib/e2e-debug-bridge';
import { initPlatform } from './lib/platform';
import { startStartupReads } from './lib/startup-reads';

// Settings, recents and reading progress are read while the platform check
// below is out; App picks them up when it mounts.
startStartupReads();

// Settle which OS we're on before the first paint, so shortcuts and chrome
// are right from the start.
await initPlatform();
startupMark('platform-ready');

const app = mount(App, { target: document.getElementById('app')! });
startupMark('app-mounted');

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
