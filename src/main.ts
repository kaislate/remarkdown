import { mount } from 'svelte';
import App from './App.svelte';
import { flushSave } from './lib/save';

const app = mount(App, { target: document.getElementById('app')! });

// Flush on window close; Tauri 2.x emits beforeunload through the webview.
window.addEventListener('beforeunload', () => {
  // Fire-and-forget — the save is debounced so this may already be done.
  flushSave().catch(() => {});
});

export default app;
