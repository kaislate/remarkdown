// Fetches release notes from the GitHub Releases API for every version
// strictly newer than the user's current version. Used by UpdateModal
// to show an aggregated changelog when the user is multiple versions
// behind.
//
// Returns null on any network/parse failure — UpdateModal falls back to
// rendering only the manifest's single `body` field in that case.

const REPO_OWNER = 'kaislate';
const REPO_NAME = 'remarkdown';

export interface ReleaseEntry {
  version: string;       // e.g., "v0.5.2-beta"
  name: string;          // human-readable title (falls back to tag_name)
  body: string;          // raw markdown release notes
  publishedAt: string;   // ISO 8601 date
  prerelease: boolean;
}

export async function fetchNewerReleases(
  currentVersion: string,
  includePrereleases: boolean = false,
): Promise<ReleaseEntry[] | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=20`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return null;
    const releases = (await res.json()) as Array<{
      tag_name: string;
      name?: string | null;
      body?: string | null;
      published_at: string;
      draft: boolean;
      prerelease?: boolean;
    }>;
    if (!Array.isArray(releases)) return null;

    return releases
      .filter((r) => !r.draft)
      .filter((r) => includePrereleases || !r.prerelease)
      .filter((r) => isStrictlyNewer(r.tag_name, currentVersion))
      .map((r) => ({
        version: r.tag_name,
        name: r.name?.trim() || r.tag_name,
        body: (r.body ?? '').trim(),
        publishedAt: r.published_at,
        prerelease: r.prerelease ?? false,
      }))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  } catch {
    return null;
  }
}

// Compare two version strings (with optional 'v' prefix and -beta / -rc /
// -alpha pre-release suffixes). Returns true if `tag` is strictly newer
// than `current`. Pre-release ordering follows SemVer 2.0.0:
//   1.0.0-alpha < 1.0.0-beta < 1.0.0-rc < 1.0.0
//   0.5.0-beta < 0.5.1-beta < 0.5.2-beta
//
// Robust enough for our release cadence (M.m.p plus optional -<word>[.N]
// pre-release). Returns false on parse failure rather than throwing.
export function isStrictlyNewer(tag: string, current: string): boolean {
  return compareVersions(tag, current) > 0;
}

function compareVersions(a: string, b: string): number {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return 0;
  for (let i = 0; i < 3; i++) {
    if (A.parts[i] !== B.parts[i]) return A.parts[i] - B.parts[i];
  }
  // Equal MAJOR.MINOR.PATCH — compare prerelease tails.
  // Per SemVer: pre-release < no pre-release.
  if (A.pre === null && B.pre === null) return 0;
  if (A.pre === null) return 1;  // A is stable, B is pre → A newer
  if (B.pre === null) return -1; // B is stable, A is pre → B newer
  return comparePrerelease(A.pre, B.pre);
}

function parseVersion(raw: string): { parts: [number, number, number]; pre: string[] | null } | null {
  const stripped = raw.replace(/^v/, '');
  const m = stripped.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!m) return null;
  const parts: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const pre = m[4] ? m[4].split('.') : null;
  return { parts, pre };
}

function comparePrerelease(a: string[], b: string[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    const aIsNum = /^\d+$/.test(av);
    const bIsNum = /^\d+$/.test(bv);
    if (aIsNum && bIsNum) {
      const d = Number(av) - Number(bv);
      if (d !== 0) return d;
    } else if (aIsNum && !bIsNum) {
      return -1; // numeric < alphanumeric per SemVer
    } else if (!aIsNum && bIsNum) {
      return 1;
    } else {
      const d = av.localeCompare(bv);
      if (d !== 0) return d;
    }
  }
  return a.length - b.length;
}
