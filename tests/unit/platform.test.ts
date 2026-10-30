import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/tauri-api', () => ({
  desktopEnv: vi.fn(),
}));

import { desktopEnv } from '../../src/lib/tauri-api';
import {
  initPlatform,
  platform,
  isMac,
  isTilingDesktop,
  osFromUserAgent,
  setPlatformForTests,
} from '../../src/lib/platform';

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const LINUX_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

describe('osFromUserAgent', () => {
  it('knows a Mac WKWebView', () => expect(osFromUserAgent(MAC_UA)).toBe('macos'));
  it('knows a Linux WebKitGTK', () => expect(osFromUserAgent(LINUX_UA)).toBe('linux'));
  it('knows WebView2', () => expect(osFromUserAgent(WIN_UA)).toBe('windows'));
  it('falls back to windows for anything unknown', () =>
    expect(osFromUserAgent('something else')).toBe('windows'));
});

// vitest.config.ts pins jsdom's user agent. Without it jsdom names the host
// (process.platform), and a run on a Mac or Linux runner tests a different app.
describe('the test environment', () => {
  it('is WebView2 on Windows whatever machine runs the tests', () => {
    expect(navigator.userAgent).toMatch(/Windows NT 10\.0; Win64; x64/);
    expect(osFromUserAgent(navigator.userAgent)).toBe('windows');
  });
});

describe('initPlatform', () => {
  beforeEach(() => {
    document.body.className = '';
    vi.mocked(desktopEnv).mockReset();
    setPlatformForTests('windows', false);
  });

  it('marks the body with the OS and tiling class from the backend', async () => {
    vi.mocked(desktopEnv).mockResolvedValue({ os: 'linux', tiling: true });
    await initPlatform();
    expect(platform()).toBe('linux');
    expect(isTilingDesktop()).toBe(true);
    expect(document.body.classList.contains('platform-linux')).toBe(true);
    expect(document.body.classList.contains('tiling-desktop')).toBe(true);
  });

  it('falls back to the user agent when the backend fails', async () => {
    vi.mocked(desktopEnv).mockRejectedValue(new Error('no backend'));
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA);
    await initPlatform();
    expect(platform()).toBe('macos');
    expect(isMac()).toBe(true);
    expect(isTilingDesktop()).toBe(false);
    expect(document.body.classList.contains('platform-macos')).toBe(true);
    expect(document.body.classList.contains('tiling-desktop')).toBe(false);
    vi.restoreAllMocks();
  });
});
