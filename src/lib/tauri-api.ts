import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { OS } from './platform';

export interface ReadDocumentResult {
  path: string;
  dir: string;
  markdown: string;
  sidecarRaw: string | null;
  // A sidecar is there but will never load: it's too large, isn't an
  // ordinary file (a folder, or a link to a device), or isn't text. Any
  // other read error fails readDocument, as it may pass.
  sidecarUnreadable?: boolean;
  sha256: string;
  bytes: number;
}

export async function openFileDialog(): Promise<string | null> {
  const result = await invoke<string | null>('open_file_dialog');
  return result;
}

// A picture for the editor's Image button; starts in the document's folder.
export async function openImageDialog(startDir?: string): Promise<string | null> {
  return await invoke<string | null>('open_image_dialog', { startDir: startDir ?? null });
}

// A file on a share that has stopped answering (a stalled network mount, a
// link into a /net automount) keeps a read waiting for good, and opens run
// one at a time (runOpenExclusive), so every later open in the window would
// wait with it, at every launch if it's a saved tab. Past this, reading or
// looking for a file fails as a read error does. A real document is read
// long before: it's at most 50 MB, and usually a few KB.
export const FILE_WAIT_MS = 60_000;

function withinFileWait<T>(call: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject({ Io: 'it took over a minute to answer' }), FILE_WAIT_MS);
    call.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function readDocument(path: string): Promise<ReadDocumentResult> {
  // Rust returns fields with snake_case by default in tauri 2.x unless configured.
  // We remap once here so the rest of the frontend sees camelCase only.
  const raw = await withinFileWait(invoke<any>('read_document', { path }));
  return {
    path: raw.path,
    dir: raw.dir,
    markdown: raw.markdown,
    sidecarRaw: raw.sidecar_raw ?? raw.sidecarRaw ?? null,
    sidecarUnreadable: raw.sidecar_unreadable ?? raw.sidecarUnreadable ?? false,
    sha256: raw.sha256,
    bytes: raw.bytes,
  };
}

export async function writeSidecar(mdPath: string, json: string): Promise<void> {
  await invoke('write_sidecar', { mdPath, json });
}

// Returns the sha256 of what was written. With `expectedSha`, Rust refuses
// with { Conflict: diskSha } when the file changed on disk since then.
export async function writeDocument(path: string, markdown: string, expectedSha: string | null = null): Promise<string> {
  return await invoke<string>('write_document', { path, markdown, expectedSha256: expectedSha });
}

export async function pushRecent(path: string, max?: number): Promise<string[]> {
  return await invoke<string[]>('push_recent', { path, max });
}

export async function listRecent(): Promise<string[]> {
  return await invoke<string[]>('list_recent');
}

export async function clearRecent(): Promise<void> {
  await invoke('clear_recent');
}

export async function removeRecent(path: string): Promise<string[]> {
  return await invoke<string[]>('remove_recent', { path });
}

export async function checkPathsExist(paths: string[]): Promise<boolean[]> {
  return await withinFileWait(invoke<boolean[]>('check_paths_exist', { paths }));
}

export function toAssetUrl(absolutePath: string): string {
  return convertFileSrc(absolutePath);
}

// Moves a sidecar that couldn't be loaded aside; returns where to, or null
// when there's no sidecar any more (nothing to back up).
export async function backupCorruptSidecar(mdPath: string): Promise<string | null> {
  return await invoke<string | null>('backup_corrupt_sidecar', { mdPath });
}

export async function loadSettingsJson(): Promise<string | null> {
  return await invoke<string | null>('load_settings');
}

export async function saveSettingsJson(json: string): Promise<void> {
  await invoke('save_settings', { json });
}

export async function loadReadingProgressJson(): Promise<string | null> {
  return await invoke<string | null>('load_reading_progress');
}

export async function saveReadingProgressJson(json: string): Promise<void> {
  await invoke('save_reading_progress', { json });
}

export async function ensureWelcomeDoc(): Promise<string> {
  return await invoke<string>('ensure_welcome_doc');
}

// ---------------------------------------------------------------------------
// Launch-file handling. Rust queues paths from our own argv and from second
// launches (single instance); we drain the queue on startup and whenever Rust
// emits 'open-requested'.

export async function takePendingOpens(): Promise<string[]> {
  try {
    return await invoke<string[]>('take_pending_opens');
  } catch {
    return []; // non-Tauri host
  }
}

export async function openDocumentWindow(path: string): Promise<void> {
  await invoke('open_document_window', { path });
}

export async function loadSessionJson(): Promise<string | null> {
  return await invoke<string | null>('load_session');
}

export async function saveSessionJson(json: string): Promise<void> {
  await invoke('save_session', { json });
}

// Outside Tauri (vitest, Playwright) listen() rejects. The local set keeps
// the callback reachable so tests — and the e2e bridge — can fire it.
const localOpenRequested = new Set<() => void>();

export async function onOpenRequested(cb: () => void): Promise<() => void> {
  localOpenRequested.add(cb);
  let unlisten: (() => void) | null = null;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    unlisten = await listen('open-requested', () => cb());
  } catch {
    // non-Tauri host
  }
  return () => {
    localOpenRequested.delete(cb);
    unlisten?.();
  };
}

export function fireOpenRequestedForTests(): void {
  for (const cb of [...localOpenRequested]) cb();
}

// The current webview window's label ('main' for the first window,
// 'doc-N' for windows opened in new-window mode). 'main' outside Tauri.
export function windowLabel(): string {
  try {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
    }).__TAURI_INTERNALS__;
    return internals?.metadata?.currentWindow?.label ?? 'main';
  } catch {
    return 'main';
  }
}

// ---------------------------------------------------------------------------
// Default app (Windows). Windows only lets the user make the final choice;
// makeDefaultApp registers remarkdown and opens the right Windows UI for it.

export interface DefaultAppStatus {
  supported: boolean;
  md: boolean;
  markdown: boolean;
}

export async function defaultAppStatus(): Promise<DefaultAppStatus> {
  return await invoke<DefaultAppStatus>('default_app_status');
}

export async function makeDefaultApp(): Promise<void> {
  await invoke('make_default_app');
}

// Opens the file's folder in the file manager (Explorer, Finder, ...) with the file selected.
export async function revealInFolder(path: string): Promise<void> {
  await invoke('reveal_in_folder', { path });
}

// Opens a document's web or mail link in the user's browser or mail app.
// Rust takes only http(s) and mailto (shell.rs, external_url).
export async function openExternal(url: string): Promise<void> {
  await invoke('open_external', { url });
}

// Which OS and kind of desktop we're on; see platform.ts for the cached view.
export async function desktopEnv(): Promise<{ os: OS; tiling: boolean }> {
  return await invoke<{ os: OS; tiling: boolean }>('desktop_env');
}
