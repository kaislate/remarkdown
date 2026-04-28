import { mount } from 'svelte';
import App from './App.svelte';
import { flushSave } from './lib/save';
import { installE2EBridge } from './lib/e2e-debug-bridge';

const app = mount(App, { target: document.getElementById('app')! });

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
