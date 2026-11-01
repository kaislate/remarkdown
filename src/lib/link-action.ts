// What a click on a link in the reader does. Documents come from anywhere,
// so a link is only ever one of:
//  - '#id'                → scroll to that element on the page (footnotes)
//  - a relative .md path  → open that document, from this one's folder
//  - http(s) / mailto     → the user's browser or mail app
// and everything else (file:, javascript:, custom schemes, absolute and
// network paths, other kinds of file) does nothing. The window itself
// never follows a link: Rust refuses that too (navigation.rs).

import { joinPath } from './image-paths';

export type LinkAction =
  | { kind: 'scroll'; id: string }
  | { kind: 'open'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' };

const NONE: LinkAction = { kind: 'none' };
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const MD_RE = /\.(md|markdown)$/i;
// Hosts that only mean something inside the app's webview.
const INTERNAL_HOSTS = new Set(['tauri.localhost', 'asset.localhost', 'ipc.localhost']);

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export function linkAction(href: string | null | undefined, docDir: string | null | undefined): LinkAction {
  const raw = (href ?? '').trim();
  if (!raw) return NONE;
  if (raw.startsWith('#')) {
    const id = decode(raw.slice(1));
    return id ? { kind: 'scroll', id } : NONE;
  }
  const scheme = SCHEME_RE.exec(raw)?.[1].toLowerCase();
  if (scheme) return outside(raw, scheme);
  return otherDocument(raw, docDir);
}

function outside(raw: string, scheme: string): LinkAction {
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') return NONE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NONE;
  }
  if (scheme === 'mailto') return url.pathname ? { kind: 'external', url: url.href } : NONE;
  if (!url.hostname || INTERNAL_HOSTS.has(url.hostname)) return NONE;
  return { kind: 'external', url: url.href };
}

function otherDocument(raw: string, docDir: string | null | undefined): LinkAction {
  if (!docDir) return NONE;
  const rel = decode(raw.split(/[?#]/, 1)[0]);
  // A leading slash or backslash (before or after decoding) is an absolute
  // path or another machine; a colon a drive or an NTFS stream.
  if (!rel || /^[\\/]/.test(raw) || /^[\\/]/.test(rel) || rel.includes(':')) return NONE;
  if (/[\x00-\x1f]/.test(rel) || !MD_RE.test(rel)) return NONE;

  // A document on a network share (\\server\share\…): joinPath knows only
  // drives and '/', so the share is joined as a plain folder, and a link
  // that climbs out of it (to another server) is refused.
  const unc = /^[\\/]{2}/.test(docDir);
  const base = unc ? docDir.slice(1) : docDir;
  let path = joinPath(base, rel);
  if (unc) {
    const [server, share] = base.split(/[\\/]/).filter(Boolean);
    if (!server || !share) return NONE;
    if (!path.toLowerCase().startsWith(`/${server}/${share}/`.toLowerCase())) return NONE;
    path = `/${path}`;
  }
  // Same separators as the document's own path, so the tab and recent list
  // name the file the way the rest of the app does.
  return { kind: 'open', path: docDir.includes('\\') ? path.replace(/\//g, '\\') : path };
}
