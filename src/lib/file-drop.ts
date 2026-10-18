// Wires Tauri's native drag-drop events to the doc-loading flow so that
// dropping a .md / .markdown file from Explorer (or Finder, Files, etc.)
// onto the window opens it. Every dropped markdown file opens, through the
// same openPaths() as everything else, so the open-mode setting applies.
//
// Tauri 2 intercepts file drags at the OS level — they never reach the
// webview's HTML drag-and-drop API. We must subscribe via the webview
// drag-drop event channel instead.

import { getCurrentWebview } from '@tauri-apps/api/webview';
import { openPaths } from './open-files';
import { addToast } from '../stores/toasts';

const MD_RE = /\.(md|markdown)$/i;

export async function installFileDropHandler(): Promise<() => void> {
  let unlisten: (() => void) | null = null;
  try {
    const webview = getCurrentWebview();
    unlisten = await webview.onDragDropEvent(async (event) => {
      const payload = event.payload as { type: string; paths?: string[] };
      if (payload.type !== 'drop') return;
      const paths = payload.paths ?? [];
      const mdPaths = paths.filter((p) => MD_RE.test(p));
      if (mdPaths.length === 0) {
        addToast({
          kind: 'warning',
          message: 'Drop a .md or .markdown file to open it.',
        });
        return;
      }
      try {
        await openPaths(mdPaths);
      } catch (err) {
        addToast({
          kind: 'error',
          message: `Could not open file: ${String(err)}`,
        });
      }
    });
  } catch {
    // Running outside Tauri (e.g., Playwright vanilla Chromium). No-op.
  }
  return () => { unlisten?.(); };
}
