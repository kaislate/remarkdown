import { describe, it, expect } from 'vitest';
import { isStrictlyNewer } from '../../src/lib/release-notes';

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
