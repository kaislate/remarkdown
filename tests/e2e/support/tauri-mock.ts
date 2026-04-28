// tests/e2e/support/tauri-mock.ts
// A localStorage-backed stand-in for @tauri-apps/api/core used by Playwright E2E.

// Stub classes required by @tauri-apps/plugin-fs (which imports from @tauri-apps/api/core
// via the vite alias). These are never actually called in the browser mock — they just
// need to exist so the build doesn't fail with "not exported" errors.
export class Resource {
  protected rid!: number;
  async close(): Promise<void> { /* no-op */ }
}
export class Channel<T = unknown> {
  id: number = 0;
  onmessage: (response: T) => void = () => { /* no-op */ };
}

interface Doc { markdown: string; sidecar_raw: string | null; sha256: string; bytes: number; }

function docKey(path: string): string { return `rmd-doc::${path}`; }
function sidecarKey(path: string): string { return `rmd-sidecar::${path}`; }
function hashBytes(bytes: Uint8Array): string {
  let h = 0;
  for (const b of bytes) h = ((h << 5) - h + b) | 0;
  return (h >>> 0).toString(16).padStart(64, '0');
}

function getDoc(path: string): Doc | null {
  const raw = localStorage.getItem(docKey(path));
  return raw ? (JSON.parse(raw) as Doc) : null;
}

export async function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case 'open_file_dialog': {
      const path = (window as any).__E2E_DIALOG_PATH__ ?? null;
      return path;
    }
    case 'read_document': {
      const path = args?.path as string;
      const doc = getDoc(path);
      if (!doc) throw { Io: `File not found: ${path}` };
      const sidecar_raw = localStorage.getItem(sidecarKey(path));
      return {
        path,
        dir: path.split(/[\\/]/).slice(0, -1).join('/') || '/',
        markdown: doc.markdown,
        sidecar_raw,
        sha256: doc.sha256,
        bytes: doc.bytes,
      };
    }
    case 'write_sidecar': {
      const mdPath = args?.mdPath as string;
      const json = args?.json as string;
      localStorage.setItem(sidecarKey(mdPath), json);
      return;
    }
    case 'push_recent': {
      const path = args?.path as string;
      const list = JSON.parse(localStorage.getItem('rmd-recent') ?? '[]');
      const next = [path, ...list.filter((p: string) => p !== path)].slice(0, 10);
      localStorage.setItem('rmd-recent', JSON.stringify(next));
      return next;
    }
    case 'list_recent': {
      return JSON.parse(localStorage.getItem('rmd-recent') ?? '[]');
    }
    case 'clear_recent': {
      localStorage.removeItem('rmd-recent');
      return;
    }
    case 'check_paths_exist': {
      const paths = args?.paths as string[];
      return paths.map((p) => getDoc(p) !== null);
    }
    case 'backup_corrupt_sidecar': {
      const path = args?.mdPath as string;
      const raw = localStorage.getItem(sidecarKey(path));
      if (!raw) throw { Io: 'sidecar does not exist' };
      const backupKey = `${sidecarKey(path)}.corrupt-${Date.now()}`;
      localStorage.setItem(backupKey, raw);
      localStorage.removeItem(sidecarKey(path));
      return backupKey;
    }
  }
  throw new Error(`[mock] unhandled command: ${cmd}`);
}

export function convertFileSrc(path: string): string {
  return `asset://localhost/${path}`;
}

// Test-only helpers exposed on `window` so Playwright can drive state.
(window as any).__E2E_SEED_DOC__ = (path: string, markdown: string) => {
  const bytes = new TextEncoder().encode(markdown);
  localStorage.setItem(docKey(path), JSON.stringify({
    markdown,
    sidecar_raw: null,
    sha256: hashBytes(bytes),
    bytes: bytes.length,
  }));
};
(window as any).__E2E_SET_DIALOG_PATH__ = (path: string | null) => {
  (window as any).__E2E_DIALOG_PATH__ = path;
};
(window as any).__E2E_CLEAR_ALL__ = () => {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('rmd-')) {
      localStorage.removeItem(k);
    }
  }
};
