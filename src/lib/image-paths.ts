// Where a picture in a document lives, both ways:
//  - imageSrcFor: a picture the user picked → what goes in the markdown:
//    its path relative to the document's folder (so the folder can move
//    together), with forward slashes and anything unsafe in a link
//    (spaces, brackets…) percent-encoded; a picture on another drive
//    keeps its full path.
//  - resolveImageSrc: what's in the markdown → a URL the window can load
//    (web and data URLs as they are; files through the asset protocol).

export function isWebUrl(src: string): boolean {
  return /^(https?:|asset:|data:|blob:|file:)/i.test(src) || /^https?:\/\/asset\.localhost/i.test(src);
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

export function imageSrcFor(docDir: string, picked: string): string {
  const from = splitPath(docDir);
  const to = splitPath(picked);
  const sameRoot = from.length > 0 && to.length > 0 && from[0].toLowerCase() === to[0].toLowerCase();
  if (!sameRoot) return to.map((p, i) => (i === 0 && /^[A-Za-z]:$/.test(p) ? p : encodePart(p))).join('/');
  let i = 0;
  // Windows paths aren't case-sensitive.
  while (i < from.length && i < to.length && from[i].toLowerCase() === to[i].toLowerCase()) i++;
  const up = from.slice(i).map(() => '..');
  return [...up, ...to.slice(i).map(encodePart)].join('/');
}

function decode(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

export function resolveImageSrc(src: string, baseDir: string | undefined, toAssetUrl: ((path: string) => string) | undefined): string {
  if (!src || isWebUrl(src) || !toAssetUrl) return src;
  const path = decode(src);
  if (isDrivePath(path)) return toAssetUrl(slashes(path));
  if (path.startsWith('/') || !baseDir) return src;
  return toAssetUrl(joinPath(baseDir, path));
}
