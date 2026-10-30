import { describe, it, expect, afterEach } from 'vitest';
import { samePath } from '../../src/stores/tabs';
import { setPlatformForTests } from '../../src/lib/platform';

afterEach(() => setPlatformForTests('windows'));

describe('samePath per platform', () => {
  it('linux file names are case-sensitive', () => {
    setPlatformForTests('linux');
    expect(samePath('/home/me/Notes.md', '/home/me/notes.md')).toBe(false);
    expect(samePath('/home/me/a.md', '/home/me/a.md')).toBe(true);
  });

  it('macos ignores case but leaves separators alone', () => {
    setPlatformForTests('macos');
    expect(samePath('/home/me/Notes.md', '/home/me/notes.md')).toBe(true);
    expect(samePath('/home/me/a.md', '/home/me/a.md')).toBe(true);
    expect(samePath('/home/me/a.md', '\\home\\me\\a.md')).toBe(false);
  });

  it('windows treats slashes and case as the same', () => {
    setPlatformForTests('windows');
    expect(samePath('C:\\A.md', 'c:/a.md')).toBe(true);
  });
});
