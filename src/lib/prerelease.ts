// Shared helper: turn a semver version string into a short label (BETA /
// ALPHA / RC / DEV) for the brand pre-release pin, or null if the
// version is a 1.0+ stable release with no suffix.

export function derivePreReleaseLabel(version: string): string | null {
  const lower = version.toLowerCase();
  if (lower.includes('-alpha')) return 'ALPHA';
  if (lower.includes('-rc')) return 'RC';
  if (lower.includes('-beta')) return 'BETA';
  if (lower.includes('-dev')) return 'DEV';
  // Zero-major versions (0.x.y) are pre-1.0 by convention — call them
  // BETA so the build still signals "this is not the stable release"
  // even when no explicit suffix is present.
  if (/^0\./.test(version)) return 'BETA';
  return null;
}
