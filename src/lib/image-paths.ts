// Where a picture in a document lives, both ways:
//  - imageSrcFor: a picture the user picked → what goes in the markdown:
//    its path relative to the document's folder (so the folder can move
//    together), with forward slashes and anything unsafe in a link
//    (spaces, brackets…) percent-encoded; a picture on another drive
//    keeps its full path (POSIX has one root, so there it's always relative).
//  - resolveImageSrc: what's in the markdown → a URL the window can load
//    (web and data URLs as they are; files through the asset protocol;
//    nothing at all for the unsafe ones below).

import { platform } from './platform';

export function isWebUrl(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

// Only ASCII escapes: every character that matters below is ASCII, and
// this never fails on a stray % the way decodeURIComponent does.
const decodeAscii = (s: string) => s.replace(/%([0-7][0-9A-Fa-f])/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

// The src as the window's URL parser reads it: tabs and newlines dropped,
// spaces and control characters trimmed, backslashes as slashes.
const asParsed = (s: string) => s.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/\\/g, '/');

function unsafeReading(s: string): boolean {
  // \\host\share, \\?\…, \\.\…, //host (any slashes) and NT's \??\ prefix.
  if (s.startsWith('//') || s.startsWith('/??/')) return true;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(s)?.[1].toLowerCase();
  if (scheme === 'asset' || scheme === 'file' || scheme === 'ipc' || scheme === 'tauri') return true;
  if (scheme !== 'http' && scheme !== 'https') return false;
  // The app's own protocols are served from *.localhost; the parser
  // undoes the tricks (http:host, %2E, user@, a trailing dot).
  try {
    return new URL(s).hostname.replace(/\.+$/, '').endsWith('.localhost');
  } catch {
    return true;
  }
}

// A src a markdown file must never make the app load: the asset protocol
// or another of the app's own URLs, a file: URL, or a network share or
// device path. On Windows merely looking a share up signs in to it with
// the user's password hash, so this is checked on the src as written and
// on every percent-decoded form of it, before anything touches it.
export function isUnsafeImageSrc(src: string): boolean {
  let s = src;
  for (let round = 0; round < 4; round++) {
    if (unsafeReading(asParsed(s))) return true;
    const next = decodeAscii(s);
    if (next === s) return false;
    s = next;
  }
  return true;
}

const isDrivePath = (p: string) => /^[A-Za-z]:[\\/]/.test(p);
const slashes = (p: string) => p.replace(/\\/g, '/');

function splitPath(p: string): string[] {
  return slashes(p).split('/').filter(Boolean);
}

// Joins and tidies (`.` and `..`), keeping a drive letter or leading slash.
export function joinPath(baseDir: string, rel: string): string {
  const base = slashes(baseDir);
  const drive = isDrivePath(base) ? base.slice(0, 2) : '';
  const stack: string[] = [];
  for (const part of [...splitPath(drive ? base.slice(2) : base), ...splitPath(rel)]) {
    if (part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return `${drive}/${stack.join('/')}`;
}

const encodePart = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Windows and a Mac's usual volume don't tell Notes from notes; Linux does.
const fold = (s: string) => (platform() === 'linux' ? s : s.toLowerCase());

export function imageSrcFor(docDir: string, picked: string): string {
  const from = splitPath(docDir);
  const to = splitPath(picked);
  const sameRoot = platform() !== 'windows' || (from.length > 0 && to.length > 0 && from[0].toLowerCase() === to[0].toLowerCase());
  if (!sameRoot) return to.map((p, i) => (i === 0 && /^[A-Za-z]:$/.test(p) ? p : encodePart(p))).join('/');
  let i = 0;
  while (i < from.length && i < to.length && fold(from[i]) === fold(to[i])) i++;
  const up = from.slice(i).map(() => '..');
  return [...up, ...to.slice(i).map(encodePart)].join('/');
}

// macOS mounts /net/<host> (and /Network/…) from that host the first time
// anything looks there, and Linux's autofs often does the same for /net:
// a picture there would reach out to whatever host the document names.
const isAutomounted = (path: string) => /^\/(net|network)(\/|$)/i.test(joinPath('', path));

// A file the window loads through the asset protocol.
function fileUrl(path: string, toAssetUrl: (path: string) => string): string {
  return platform() !== 'windows' && isAutomounted(path) ? '' : toAssetUrl(path);
}

function decode(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

export function resolveImageSrc(src: string, baseDir: string | undefined, toAssetUrl: ((path: string) => string) | undefined): string {
  if (!src) return src;
  // An empty src is a picture that asks for nothing.
  if (isUnsafeImageSrc(src)) return '';
  if (isWebUrl(src) || !toAssetUrl) return src;
  const path = decode(src);
  if (isDrivePath(path)) return toAssetUrl(slashes(path));
  // A leading slash is a full file path on macOS and Linux; Windows leaves it be.
  if (path.startsWith('/') && platform() !== 'windows') return fileUrl(path, toAssetUrl);
  if (path.startsWith('/') || !baseDir) return src;
  return fileUrl(joinPath(baseDir, path), toAssetUrl);
}
