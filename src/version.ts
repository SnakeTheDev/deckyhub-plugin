// Version parsing and comparison, kept free of imports so `pnpm run
// test:frontend` can run it under plain Node.

export const normalizeVersion = (value: string) => value.trim().replace(/^v/i, "");

// One display format for every version: "v" + the version number, keeping a
// pre-release suffix — "plugin-v3.3.0" → v3.3.0, "Release-0.7.5" → v0.7.5,
// "1.0.3-rc.2" → v1.0.3-rc.2. Anything without a version number is shown as is.
export function displayVersion(value: string) {
  const match = value.match(/(\d+(?:\.\d+)+)(-[0-9A-Za-z.-]+)?/);
  return match ? `v${match[1]}${match[2] ?? ""}` : value;
}

// The version number and pre-release suffix inside a tag or version string —
// the same part displayVersion() shows: "plugin-v3.3.0" → 3.3.0,
// "1.0.3-rc.2" → 1.0.3 + "rc.2". Null when there's no dotted version number.
function parseVersion(value: string) {
  const match = value.match(/(\d+(?:\.\d+)+)(?:-([0-9A-Za-z.-]+))?/);
  return match ? { release: match[1].split(".").map(Number), prerelease: match[2] ?? null } : null;
}

// A version with no pre-release suffix outranks the same release number with
// one ("1.0.3" > "1.0.3-rc.9"). Suffixes compare piece by piece, splitting
// letters from digits so "rc9" < "rc10" as well as "rc.9" < "rc.10": numbers
// numerically, words alphabetically ("alpha" < "beta" < "rc"), a number below
// a word, and a shorter suffix below a longer one it starts ("rc" < "rc.1").
function comparePrerelease(target: string | null, current: string | null): number {
  if (target === current) return 0;
  if (target === null) return 1;
  if (current === null) return -1;
  const a = target.toLowerCase().match(/\d+|[a-z]+/g) ?? [];
  const b = current.toLowerCase().match(/\d+|[a-z]+/g) ?? [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const aNumber = /^\d/.test(a[i]), bNumber = /^\d/.test(b[i]);
    const diff = aNumber && bNumber ? Number(a[i]) - Number(b[i]) : aNumber !== bNumber ? (aNumber ? -1 : 1) : a[i].localeCompare(b[i]);
    if (diff) return Math.sign(diff);
  }
  return Math.sign(a.length - b.length);
}

// 1 / -1 / 0 as target is newer / older / the same as current, or null when
// either has no version number. Used for DeckyHub itself and every tracked
// app, so pre-release suffixes count everywhere (rc.1 → rc.2 → final).
export function compareVersions(target: string, current: string): number | null {
  const a = parseVersion(target), b = parseVersion(current);
  if (!a || !b) return null;
  for (let i = 0; i < Math.max(a.release.length, b.release.length); i++) {
    const diff = (a.release[i] || 0) - (b.release[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

// The stable channel sees only stable releases; the pre-release channel sees
// everything, so a stable release newer than the last pre-release still
// reaches people on pre-releases.
export const inChannel = (release: { prerelease: boolean }, channel: "stable" | "prerelease") => channel === "prerelease" || !release.prerelease;
