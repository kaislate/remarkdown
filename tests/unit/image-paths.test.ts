import { describe, it, expect, afterEach, vi } from 'vitest';
import { imageSrcFor, resolveImageSrc } from '../../src/lib/image-paths';
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
