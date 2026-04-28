import { writable, get } from 'svelte/store';
import { readDocument, toAssetUrl } from '../lib/tauri-api';
import { render } from '../lib/MarkdownRenderer';
import { loadSidecar } from '../lib/sidecar';
import { docEpoch, replaceAll, orphanedAnnots } from './annots';
import { addToast } from './toasts';
import { openModal } from './modals';
import { installFileWatcher } from '../lib/file-watch';
import type { Annotation } from '../lib/schema';
import { getProgressFor } from './reading-progress';
import { viewerScroll } from './viewport';
import { settings } from './settings';
import { readerMode } from './reader-mode';

export interface DocState {
  path: string;
  dir: string;
  sha256: string;
  bytes: number;
  markdown: string;
  html: string;
  plaintext: string;
  blocks: string[];
  sidecarRaw: string | null;
}

export const doc = writable<DocState | null>(null);

let currentDispose: (() => Promise<void>) | null = null;

export async function loadDocument(path: string): Promise<void> {
  let r;
  try {
    r = await readDocument(path);
  } catch (err) {
    if (err && typeof err === 'object' && 'NotUtf8' in err) {
      addToast({ kind: 'error', message: 'This file is not UTF-8 — remarkdown only supports UTF-8 markdown files.' });
    } else if (err && typeof err === 'object' && 'Io' in err) {
      addToast({ kind: 'error', message: `Could not open file: ${(err as Record<string, unknown>).Io}` });
    } else {
      addToast({ kind: 'error', message: `Could not open file: ${String(err)}` });
    }
    return;
  }

  // Skip reload if content is unchanged — prevents loops when the watcher
  // fires on our own writes or no-op touches.
  const current = get(doc);
  if (current && current.path === r.path && current.sha256 === r.sha256) {
    return;
  }

  // Detect "user opened a new doc" vs "current doc reloaded after an
  // external edit" — only the former should auto-enter Focus mode if
  // the user has that setting on. Edit-reload keeps the current chrome
  // state so the file watcher doesn't yank the UI from under the user.
  const isNewDocOpen = !current || current.path !== r.path;

  const { html, plaintext, blocks } = await render(r.markdown, {
    baseDir: r.dir,
    toAssetUrl,
  });

  let parsedAnnotations: Annotation[] = [];
  if (r.sidecarRaw) {
    const result = loadSidecar(r.sidecarRaw);
    if (result.ok) {
      parsedAnnotations = result.value.annotations;
    } else {
      console.warn('[remarkdown] sidecar load failed:', result.error);
      openModal({ kind: 'corrupt-sidecar', path: r.path });
    }
  }
  replaceAll(parsedAnnotations);

  doc.set({
    path: r.path,
    dir: r.dir,
    sha256: r.sha256,
    bytes: r.bytes,
    markdown: r.markdown,
    html,
    plaintext,
    blocks,
    sidecarRaw: r.sidecarRaw,
  });
  docEpoch.update((e) => e + 1);

  if (isNewDocOpen && get(settings).openInFocusMode) {
    readerMode.set(true);
  }

  // Restore scroll position from saved reading progress.
  const progress = getProgressFor(path);
  if (progress && progress.scrollRatio > 0.001) {
    // Defer two animation frames so the article renders + computes layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scrollEl = get(viewerScroll);
        if (!scrollEl) return;
        const max = scrollEl.scrollHeight - scrollEl.clientHeight;
        if (max > 0) {
          scrollEl.scrollTop = max * progress.scrollRatio;
        }
      });
    });
  }

  // Cancel previous watcher (if any) and install a new one for this path.
  if (currentDispose) {
    await currentDispose();
    currentDispose = null;
  }
  currentDispose = await installFileWatcher(path, () => {
    void reloadCurrent(path);
  });
}

async function reloadCurrent(path: string): Promise<void> {
  // Capture orphan-set BEFORE reload so we can compute deltas.
  const before = new Set(get(orphanedAnnots).map((a) => a.id));
  await loadDocument(path);
  // After reload, derived stores re-partition. Compare orphan sets.
  const after = new Set(get(orphanedAnnots).map((a) => a.id));
  let reanchored = 0;
  for (const id of before) if (!after.has(id)) reanchored += 1;
  let newOrphans = 0;
  for (const id of after) if (!before.has(id)) newOrphans += 1;
  if (reanchored > 0 || newOrphans > 0) {
    addToast({
      kind: 'info',
      message: `File reloaded — ${reanchored} re-anchored, ${newOrphans} orphaned.`,
    });
  } else {
    addToast({ kind: 'info', message: 'File reloaded from disk.' });
  }
}

export function clearDocument(): void {
  doc.set(null);
  replaceAll([]);
  docEpoch.update((e) => e + 1);
}
