import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isStrictlyNewer, fetchNewerReleases } from '../../src/lib/release-notes';

describe('isStrictlyNewer', () => {
  it('compares basic semver triples', () => {
    expect(isStrictlyNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isStrictlyNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isStrictlyNewer('0.9.9', '1.0.0')).toBe(false);
  });

  it('handles "v" prefixes equally on both sides', () => {
    expect(isStrictlyNewer('v0.5.2-beta', '0.5.1-beta')).toBe(true);
    expect(isStrictlyNewer('0.5.2-beta', 'v0.5.1-beta')).toBe(true);
    expect(isStrictlyNewer('v1.0.0', 'v1.0.0')).toBe(false);
  });

  it('orders prereleases per SemVer (alpha < beta < rc < stable)', () => {
    expect(isStrictlyNewer('1.0.0', '1.0.0-rc')).toBe(true);
    expect(isStrictlyNewer('1.0.0-rc', '1.0.0-beta')).toBe(true);
    expect(isStrictlyNewer('1.0.0-beta', '1.0.0-alpha')).toBe(true);
  });

  it('orders numbered pre-releases (beta.2 > beta.1)', () => {
    expect(isStrictlyNewer('0.5.0-beta.2', '0.5.0-beta.1')).toBe(true);
    expect(isStrictlyNewer('0.5.0-beta.1', '0.5.0-beta.2')).toBe(false);
  });

  it('returns false on parse failure', () => {
    expect(isStrictlyNewer('garbage', '1.0.0')).toBe(false);
    expect(isStrictlyNewer('1.0.0', 'also-garbage')).toBe(false);
  });

  it('matches our actual release sequence', () => {
    // 0.5.0-beta < 0.5.1-beta < 0.5.2-beta
    expect(isStrictlyNewer('v0.5.1-beta', 'v0.5.0-beta')).toBe(true);
    expect(isStrictlyNewer('v0.5.2-beta', 'v0.5.1-beta')).toBe(true);
    expect(isStrictlyNewer('v0.5.0-beta', 'v0.5.2-beta')).toBe(false);
  });
});

describe('fetchNewerReleases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('filters out prereleases when includePrereleases is false (default)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { tag_name: 'v1.0.0', name: '1.0.0', body: 'stable', published_at: '2026-01-02T00:00:00Z', draft: false, prerelease: false },
      { tag_name: 'v1.1.0-beta', name: '1.1.0-beta', body: 'beta', published_at: '2026-02-01T00:00:00Z', draft: false, prerelease: true },
    ]), { status: 200 }));
    const result = await fetchNewerReleases('0.9.0');
    expect(result?.map(r => r.version)).toEqual(['v1.0.0']);
  });

  it('includes prereleases when includePrereleases is true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { tag_name: 'v1.0.0', name: '1.0.0', body: 'stable', published_at: '2026-01-02T00:00:00Z', draft: false, prerelease: false },
      { tag_name: 'v1.1.0-beta', name: '1.1.0-beta', body: 'beta', published_at: '2026-02-01T00:00:00Z', draft: false, prerelease: true },
    ]), { status: 200 }));
    const result = await fetchNewerReleases('0.9.0', true);
    expect(result?.map(r => r.version)).toEqual(['v1.1.0-beta', 'v1.0.0']);
  });

  it('always filters out drafts regardless of flag', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { tag_name: 'v1.0.0', name: '1.0.0', body: '', published_at: '2026-01-01T00:00:00Z', draft: true, prerelease: false },
    ]), { status: 200 }));
    const result = await fetchNewerReleases('0.9.0', true);
    expect(result).toEqual([]);
  });

  it('returns null on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const result = await fetchNewerReleases('0.9.0');
    expect(result).toBe(null);
  });
});
