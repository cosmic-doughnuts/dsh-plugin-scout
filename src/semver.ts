/** Minimal semver subset used by DSH peer ranges: exact, caret (0.x-aware),
 * prereleases, and `||` unions. Unsupported syntax returns undefined. */

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/

export interface Version { major: number; minor: number; patch: number; pre: string[] }

export function parseVersion(v: string): Version | undefined {
  const m = VERSION_RE.exec(v.trim())
  if (!m) return undefined
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] }
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1            // release > prerelease
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    if (xn && yn) { if (+x !== +y) return +x < +y ? -1 : 1 }
    else if (xn) return -1                 // numeric < alphanumeric
    else if (yn) return 1
    else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export function compare(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePre(a.pre, b.pre)
}

/** Upper exclusive bound of a caret range: patch for 0.0.x, minor for 0.x.y, major otherwise. */
function caretCeiling(base: Version): Version {
  if (base.major > 0) return { major: base.major + 1, minor: 0, patch: 0, pre: [] }
  if (base.minor > 0) return { major: 0, minor: base.minor + 1, patch: 0, pre: [] }
  return { major: 0, minor: 0, patch: base.patch + 1, pre: [] }
}

function satisfiesAtom(v: Version, atom: string): boolean | undefined {
  if (!atom.startsWith('^')) {
    const exact = parseVersion(atom)
    return exact ? compare(v, exact) === 0 : undefined
  }
  const base = parseVersion(atom.slice(1))
  if (!base) return undefined
  // Compare against the ceiling by release tuple only: a prerelease of the
  // ceiling version (e.g. 0.2.0-rc.2 vs ^0.1.x, ceiling 0.2.0) is excluded.
  return compare(v, base) >= 0 && compare({ ...v, pre: [] }, caretCeiling(base)) < 0
}

export function satisfies(version: string, range: string): boolean | undefined {
  const v = parseVersion(version)
  if (!v) return undefined
  const atoms = range.split('||').map(a => a.trim()).filter(a => a.length > 0)
  if (atoms.length === 0) return undefined
  let sawUnsupported = false
  for (const atom of atoms) {
    const r = satisfiesAtom(v, atom)
    if (r === undefined) { sawUnsupported = true; continue }
    if (r) return true
  }
  return sawUnsupported ? undefined : false
}
