import { desktopEnv } from './tauri-api';

export type OS = 'windows' | 'macos' | 'linux';

// null until initPlatform (or a test) settles it; getters guess from the
// user agent in the meantime.
let probed: { os: OS; tiling: boolean } | null = null;

export function osFromUserAgent(ua: string): OS {
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'windows';
}

function currentUA(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

export function platform(): OS {
  return probed?.os ?? osFromUserAgent(currentUA());
}

export function isMac(): boolean {
  return platform() === 'macos';
}

export function isTilingDesktop(): boolean {
  return probed?.tiling ?? false;
}

function markBody(): void {
  document.body.classList.add(`platform-${platform()}`);
  if (isTilingDesktop()) document.body.classList.add('tiling-desktop');
}

// Ask the backend once at startup, before anything mounts, so the first paint
// already has the right shortcuts and chrome. The user agent is the fallback
// when there is no backend to ask.
export async function initPlatform(): Promise<void> {
  try {
    probed = await desktopEnv();
  } catch {
    probed = { os: osFromUserAgent(currentUA()), tiling: false };
  }
  markBody();
}

export function setPlatformForTests(os: OS, tiling = false): void {
  probed = { os, tiling };
}
