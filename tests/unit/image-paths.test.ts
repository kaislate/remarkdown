import { describe, it, expect, afterEach, vi } from 'vitest';
import { fileSrcFromAssetUrl, imageSrcFor, isUnsafeImageSrc, resolveImageSrc } from '../../src/lib/image-paths';
import { setPlatformForTests } from '../../src/lib/platform';

afterEach(() => setPlatformForTests('windows'));

describe('image paths on linux', () => {
  it('resolves a leading-slash path through the asset url', () => {
    setPlatformForTests('linux');
    const toAsset = vi.fn((p: string) => `asset://${p}`);
    resolveImageSrc('/home/me/My Notes/pic one.png', '/home/me/doc', toAsset);
    expect(toAsset).toHaveBeenCalledWith('/home/me/My Notes/pic one.png');
  });

  it('makes a relative path inside the folder', () => {
    setPlatformForTests('linux');
    expect(imageSrcFor('/home/me/docs', '/home/me/docs/img/Pic.png')).toBe('img/Pic.png');
  });

  it('is case-sensitive: a differently-cased folder goes up and back down', () => {
    setPlatformForTests('linux');
    expect(imageSrcFor('/home/me/Docs', '/home/me/docs/x.png')).toBe('../docs/x.png');
  });

  it('reaches another top-level folder with ..', () => {
    setPlatformForTests('linux');
    expect(imageSrcFor('/home/me/docs', '/mnt/usb/x.png')).toBe('../../../mnt/usb/x.png');
  });

  it('round-trips an awkward file name', () => {
    setPlatformForTests('linux');
    const picked = "/home/me/docs/Ünïcode's #1.png";
    const src = imageSrcFor('/home/me/docs', picked);
    const toAsset = vi.fn((p: string) => p);
    resolveImageSrc(src, '/home/me/docs', toAsset);
    expect(toAsset).toHaveBeenCalledWith(picked);
  });
});

describe('image paths on macos', () => {
  it('ignores case when working out the relative path', () => {
    setPlatformForTests('macos');
    expect(imageSrcFor('/Users/me/Docs', '/Users/me/docs/x.png')).toBe('x.png');
  });

  it('resolves a leading-slash path through the asset url', () => {
    setPlatformForTests('macos');
    const toAsset = vi.fn((p: string) => p);
    resolveImageSrc('/Users/me/pic.png', undefined, toAsset);
    expect(toAsset).toHaveBeenCalledWith('/Users/me/pic.png');
  });
});

describe('image paths on windows', () => {
  it('still returns a leading-slash src untouched', () => {
    setPlatformForTests('windows');
    const toAsset = vi.fn((p: string) => p);
    expect(resolveImageSrc('/img/a.png', 'C:/docs', toAsset)).toBe('/img/a.png');
    expect(toAsset).not.toHaveBeenCalled();
  });
});

// A markdown file can name a picture on a network share or a URL the app
// itself serves. On Windows even looking such a path up sends the user's
// login hash to whoever runs the share, so none of these may load at all:
// an empty src is a picture that makes no request.
const unsafe = [
  // the asset protocol, in every spelling the window accepts
  'http://asset.localhost/%5C%5Cattacker.example%5Cs%5Cpixel.png',
  'HTTP://ASSET.LOCALHOST/x.png',
  'https://asset.localhost/%2F%2Fhost%2Fs%2Fx.png',
  'http:asset.localhost/x.png',
  'http:\\\\asset.localhost\\x.png',
  'http://asset.localhost./x.png',
  'http://user@asset.localhost/x.png',
  'http://asset%2Elocalhost/x.png',
  'http://ipc.localhost/x',
  'ht\ttp://asset.localhost/x.png',
  'asset://localhost/%5C%5Chost%5Cs%5Cx.png',
  'ASSET://localhost/x.png',
  'asset:x.png',
  // protocol-relative: the window reads it as http://asset.localhost/…
  '//asset.localhost/%5C%5Cattacker.example%5Cs%5Cx.png',
  '%2F%2Fasset.localhost%2Fx.png',
  // file URLs
  'file:///C:/Users/me/x.png',
  'file://host/share/x.png',
  'FILE:x.png',
  // network shares and device paths, with any mix of slashes
  '\\\\host\\share\\x.png',
  '//host/share/x.png',
  '\\/host/share/x.png',
  '/\\host\\share\\x.png',
  '\\\\host@SSL\\share\\x.png',
  '\\\\?\\UNC\\host\\share\\x.png',
  '\\\\?\\unc\\host\\share\\x.png',
  '//?/UNC/host/share/x.png',
  '\\\\?\\C:\\x.png',
  '//?/C:/x.png',
  '\\\\.\\pipe\\x',
  '//./C:/x.png',
  '\\??\\UNC\\host\\share\\x.png',
  ' \t\\\\host\\share\\x.png',
  // the same, percent-encoded (once or twice)
  '%5C%5Chost%5Cshare%5Cx.png',
  '%5c%5chost%5cshare%5cx.png',
  '%2F%2Fhost%2Fshare%2Fx.png',
  '/%5Chost%5Cshare%5Cx.png',
  '%5C%5C%3F%5CUNC%5Chost%5Cshare%5Cx.png',
  '%5C%3F%3F%5CUNC%5Chost%5Cshare%5Cx.png',
  '%255C%255Chost%255Cshare%255Cx.png',
  '%09%5C%5Chost%5Cshare%5Cx.png',
  '%5C%5Chost%5Cshare%5Cx%E0.png',
  'http%3A%2F%2Fasset.localhost%2Fx.png',
];

describe.each(['windows', 'linux', 'macos'] as const)('unsafe image srcs on %s', (os) => {
  it.each(unsafe)('drops %j without asking for an asset url', (src) => {
    setPlatformForTests(os);
    const toAsset = vi.fn((p: string) => `asset://${p}`);
    expect(resolveImageSrc(src, os === 'windows' ? 'C:/docs' : '/home/me/docs', toAsset)).toBe('');
    expect(toAsset).not.toHaveBeenCalled();
  });

  it.each(unsafe)('drops %j with no document folder either', (src) => {
    setPlatformForTests(os);
    expect(resolveImageSrc(src, undefined, undefined)).toBe('');
  });

  it.each(unsafe)('reports %j as unsafe', (src) => {
    setPlatformForTests(os);
    expect(isUnsafeImageSrc(src)).toBe(true);
  });
});

describe('ordinary pictures still load', () => {
  it('on windows: relative, up a folder, drive paths either way round', () => {
    setPlatformForTests('windows');
    const toAsset = vi.fn((p: string) => `asset:${p}`);
    expect(resolveImageSrc('img/a.png', 'C:\\Users\\me\\docs', toAsset)).toBe('asset:C:/Users/me/docs/img/a.png');
    expect(resolveImageSrc('../pics/a%20b.png', 'C:/Users/me/docs', toAsset)).toBe('asset:C:/Users/me/pics/a b.png');
    expect(resolveImageSrc('.%5Cimg%5Ca.png', 'C:/docs', toAsset)).toBe('asset:C:/docs/img/a.png');
    expect(resolveImageSrc('C:\\pics\\a.png', 'D:/docs', toAsset)).toBe('asset:C:/pics/a.png');
    expect(resolveImageSrc('D:/pics/a.png', 'C:/docs', toAsset)).toBe('asset:D:/pics/a.png');
    expect(resolveImageSrc('\\img\\a.png', 'C:/docs', toAsset)).toBe('asset:C:/docs/img/a.png');
  });

  it('on windows: a picked picture round-trips, on the same drive and another', () => {
    setPlatformForTests('windows');
    const toAsset = vi.fn((p: string) => p);
    const dir = 'C:\\Users\\me\\docs';
    expect(resolveImageSrc(imageSrcFor(dir, 'C:\\Users\\me\\docs\\img\\Pic one.png'), dir, toAsset)).toBe('C:/Users/me/docs/img/Pic one.png');
    expect(resolveImageSrc(imageSrcFor(dir, 'C:\\Users\\me\\Pictures\\x.png'), dir, toAsset)).toBe('C:/Users/me/Pictures/x.png');
    expect(resolveImageSrc(imageSrcFor(dir, 'E:\\Photos\\#1 (best).png'), dir, toAsset)).toBe('E:/Photos/#1 (best).png');
  });

  it.each(['linux', 'macos'] as const)('on %s: relative and full paths', (os) => {
    setPlatformForTests(os);
    const toAsset = vi.fn((p: string) => `asset:${p}`);
    expect(resolveImageSrc('img/a.png', '/home/me/docs', toAsset)).toBe('asset:/home/me/docs/img/a.png');
    expect(resolveImageSrc('../a%20b.png', '/home/me/docs', toAsset)).toBe('asset:/home/me/a b.png');
    expect(resolveImageSrc('/Users/me/pic.png', '/home/me/docs', toAsset)).toBe('asset:/Users/me/pic.png');
  });

  it.each(['windows', 'linux', 'macos'] as const)('on %s: web, data and blob urls as they are', (os) => {
    setPlatformForTests(os);
    const toAsset = vi.fn((p: string) => p);
    for (const src of [
      'https://example.com/a.png',
      'http://example.com/a.png?x=1&y=2',
      'HTTPS://Example.com/A.png',
      'http://localhost:8080/a.png',
      'data:image/png;base64,AAAA',
      'blob:http://tauri.localhost/1234',
    ]) {
      expect(resolveImageSrc(src, 'C:/docs', toAsset)).toBe(src);
      expect(isUnsafeImageSrc(src)).toBe(false);
    }
    expect(toAsset).not.toHaveBeenCalled();
  });

  it('a file whose name only looks odd is still a file', () => {
    setPlatformForTests('linux');
    const toAsset = vi.fn((p: string) => p);
    expect(resolveImageSrc('100%25%20done.png', '/home/me', toAsset)).toBe('/home/me/100% done.png');
    expect(resolveImageSrc('notes:v2.png', '/home/me', toAsset)).toBe('/home/me/notes:v2.png');
    expect(isUnsafeImageSrc('img/asset.localhost.png')).toBe(false);
  });
});

describe('automounted network folders on macos and linux', () => {
  // /net/<host> (and a Mac's /Network) mounts that host's share the first
  // time anything looks there.
  it.each(['macos', 'linux'] as const)('on %s: a picture under /net or /Network asks for nothing', (os) => {
    setPlatformForTests(os);
    const toAsset = vi.fn((p: string) => `asset:${p}`);
    for (const [src, dir] of [
      ['/net/attacker.example/export/x.png', '/Users/me/docs'],
      ['/NET/attacker.example/x.png', '/Users/me/docs'],
      ['/./net/attacker.example/x.png', '/Users/me/docs'],
      ['/Network/Servers/attacker.example/x.png', '/Users/me/docs'],
      ['%2Fnet%2Fattacker.example%2Fx.png', '/Users/me/docs'],
      ['../../../net/attacker.example/x.png', '/Users/me/docs'],
      ['attacker.example/x.png', '/net'],
    ]) {
      expect(resolveImageSrc(src, dir, toAsset), src).toBe('');
    }
    expect(toAsset).not.toHaveBeenCalled();
  });

  it.each(['macos', 'linux'] as const)('on %s: a folder only named like one is fine', (os) => {
    setPlatformForTests(os);
    const toAsset = vi.fn((p: string) => `asset:${p}`);
    expect(resolveImageSrc('/Users/me/net/x.png', '/Users/me', toAsset)).toBe('asset:/Users/me/net/x.png');
    expect(resolveImageSrc('net/x.png', '/Users/me', toAsset)).toBe('asset:/Users/me/net/x.png');
    expect(resolveImageSrc('/network.png', '/Users/me', toAsset)).toBe('asset:/network.png');
  });

  it('on windows a /net path is left as written, as any rooted path is', () => {
    setPlatformForTests('windows');
    const toAsset = vi.fn((p: string) => p);
    expect(resolveImageSrc('/net/x.png', 'C:/docs', toAsset)).toBe('/net/x.png');
    expect(toAsset).not.toHaveBeenCalled();
  });
});

describe('a picture copied from the reader', () => {
  // The reader's asset url back to a path, and that path to the same file.
  it.each([
    ['windows', 'C:/Users/me/Ünïcode\'s #1 (2).png', (p: string) => `http://asset.localhost/${encodeURIComponent(p)}`],
    ['linux', '/home/me/100% done.png', (p: string) => `asset://localhost/${encodeURIComponent(p)}`],
    ['macos', '/Users/me/a b.png', (p: string) => `asset://localhost/${encodeURIComponent(p)}`],
  ] as const)('on %s goes back to its own file', (os, file, toAsset) => {
    setPlatformForTests(os);
    const src = fileSrcFromAssetUrl(toAsset(file));
    expect(src).not.toBeNull();
    expect(resolveImageSrc(src!, undefined, toAsset)).toBe(toAsset(file));
  });

  it('is left alone when it names no plain file path', () => {
    for (const src of [
      'http://asset.localhost/%5C%5Chost%5Cs%5Cx.png',
      'asset://localhost/%2F%2Fhost%2Fs%2Fx.png',
      'http://asset.localhost/img%2Fa.png',
      'http://asset.localhost/',
      'http://asset.localhost.attacker.example/C%3A%2Fa.png',
      'http://example.com/C%3A%2Fa.png',
    ]) {
      expect(fileSrcFromAssetUrl(src), src).toBeNull();
    }
  });
});

describe('a picture pasted into a document before the check', () => {
  // Pasting a picture from the reader used to save the reader's asset url
  // in the markdown. One naming a plain file is that file, as if the
  // markdown named it, so it shows again.
  it.each([
    ['windows', 'http://asset.localhost/C%3A%2FUsers%2Fme%2Fa%20b.png', 'C:/Users/me/a b.png'],
    ['windows', 'https://ASSET.localhost/D%3A%5CPictures%5Cx.png', 'D:/Pictures/x.png'],
    ['linux', 'asset://localhost/%2Fhome%2Fme%2Fa.png', '/home/me/a.png'],
    ['macos', 'asset://localhost/%2FUsers%2Fme%2F100%25%20done.png', '/Users/me/100% done.png'],
  ] as const)('on %s shows its file again', (os, src, file) => {
    setPlatformForTests(os);
    const toAsset = vi.fn((p: string) => `asset:${p}`);
    expect(resolveImageSrc(src, os === 'windows' ? 'C:/docs' : '/home/me/docs', toAsset)).toBe(`asset:${file}`);
    expect(resolveImageSrc(src, undefined, toAsset)).toBe(`asset:${file}`);
    // Never the url as written.
    expect(resolveImageSrc(src, undefined, undefined)).not.toBe(src);
  });

  it.each(['windows', 'linux', 'macos'] as const)('on %s one naming a share or a mounted host still asks for nothing', (os) => {
    setPlatformForTests(os);
    const toAsset = vi.fn((p: string) => `asset:${p}`);
    for (const src of [
      'http://asset.localhost/%5C%5Chost%5Cs%5Cx.png',
      'asset://localhost/%2F%2Fhost%2Fs%2Fx.png',
      'http://asset.localhost/%255C%255Chost%255Cs%255Cx.png',
      'http://asset.localhost/%5C%5C%3F%5CUNC%5Chost%5Cs%5Cx.png',
      'http://asset.localhost/img%2Fa.png',
      ...(os === 'windows' ? [] : ['asset://localhost/%2Fnet%2Fhost%2Fx.png']),
    ]) {
      expect(resolveImageSrc(src, os === 'windows' ? 'C:/docs' : '/home/me/docs', toAsset), src).toBe('');
    }
    expect(toAsset).not.toHaveBeenCalled();
  });
});
