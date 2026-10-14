/** Compatibility verdicts: evaluate candidate peerDependencies against the
 * running dsh runtime versions, and fetch candidate package metadata from
 * GitHub repos (dsh.bundle presence) and the npm registry (published version
 * and peers). All network access is injectable for offline tests. */

import { createRequire } from 'node:module'
import { satisfies } from './semver.js'

export type Verdict = { status: 'compatible' | 'incompatible' | 'unknown'; reasons: string[] }
export type RuntimeVersions = Record<string, string>

export interface CandidateMeta {
  packageName: string
  version: string
  peers?: Record<string, string>
  isBundle: boolean
  source: 'npm' | 'github'
}

/** Default fetch used when opts.fetch is absent; overridable in tests. */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

let testFetch: FetchLike | undefined

/** Test seam: inject a fetch implementation. */
export function __setFetchForTests(f: FetchLike | undefined): void {
  testFetch = f
}

function defaultFetch(): FetchLike {
  return testFetch ?? (globalThis.fetch as unknown as FetchLike)
}

/** Packages whose peer ranges the dsh runtime enforces. */
const RUNTIME_PACKAGES = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh', '@deepseek-ai/dsh-settings', '@deepseek-ai/dsh-user-approval']

export function evaluatePlugin(peers: Record<string, string> | undefined, runtime: RuntimeVersions): Verdict {
  if (peers === undefined || peers === null) return { status: 'unknown', reasons: ['no peerDependencies declared'] }
  const overlapping = Object.keys(peers).filter(k => k in runtime)
  if (overlapping.length === 0) return { status: 'unknown', reasons: ['no DSH runtime peer declared'] }

  const reasons: string[] = []
  let incompatible = false
  let unknown = false
  for (const pkg of overlapping) {
    const range = peers[pkg]
    const result = satisfies(runtime[pkg], range)
    if (result === true) continue
    if (result === false) {
      incompatible = true
      reasons.push(`${pkg}: needs ${range}, runtime ${runtime[pkg]}`)
    } else {
      unknown = true
      reasons.push(`${pkg}: unsupported range syntax ${JSON.stringify(range)}`)
    }
  }
  if (incompatible) return { status: 'incompatible', reasons }
  if (unknown) return { status: 'unknown', reasons }
  return { status: 'compatible', reasons: [] }
}

/** Ordered chain: getDshRuntimeVersion() dynamic import → resolved runtime
 * package.json files → {}. Never throws. */
export async function resolveRuntimeVersions(): Promise<RuntimeVersions> {
  const versions: RuntimeVersions = {}
  try {
    const mod: { getDshRuntimeVersion?: () => string } = await import('@deepseek-ai/dsh-app-boot' as string)
    if (typeof mod.getDshRuntimeVersion === 'function') {
      versions['@deepseek-ai/dsh'] = mod.getDshRuntimeVersion()
    }
  } catch { /* not resolvable from this plugin's module context */ }
  for (const pkg of RUNTIME_PACKAGES) {
    if (versions[pkg] !== undefined) continue
    try {
      const require = createRequire(import.meta.url)
      const pkgJson: { version?: string } = await import(`${require.resolve(`${pkg}/package.json`)}?t=${Date.now()}`, { with: { type: 'json' } }).then(m => m.default)
      if (typeof pkgJson.version === 'string') versions[pkg] = pkgJson.version
    } catch { /* peer not resolvable */ }
  }
  return versions
}

async function fetchRepoPackageJson(
  repo: { owner: string; name: string },
  opts: { fetch?: FetchLike; signal?: AbortSignal },
): Promise<{ name?: string; version?: string; peerDependencies?: Record<string, string>; dsh?: { bundle?: unknown } } | undefined> {
  const f = opts.fetch ?? defaultFetch()
  const signal = opts.signal ?? AbortSignal.timeout(8000)
  for (const branch of ['main', 'master']) {
    try {
      const res = await f(`https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/package.json`, { signal })
      if (!res.ok) continue
      return await res.json() as { name?: string; version?: string; peerDependencies?: Record<string, string>; dsh?: { bundle?: unknown } }
    } catch { /* try next branch */ }
  }
  return undefined
}

async function fetchNpmLatest(
  packageName: string,
  opts: { fetch?: FetchLike; signal?: AbortSignal },
): Promise<{ version: string; peers?: Record<string, string> } | undefined> {
  const f = opts.fetch ?? defaultFetch()
  const signal = opts.signal ?? AbortSignal.timeout(8000)
  try {
    const res = await f(`https://registry.npmjs.org/${encodeURIComponent(packageName).replace('%40', '@')}`, {
      signal, headers: { Accept: 'application/vnd.npm.install-v1+json' },
    })
    if (!res.ok) return undefined
    const meta: { 'dist-tags'?: { latest?: string }; versions?: Record<string, { peerDependencies?: Record<string, string> }> } = await res.json()
    const latest = meta['dist-tags']?.latest
    if (latest === undefined) return undefined
    return { version: latest, peers: meta.versions?.[latest]?.peerDependencies }
  } catch {
    return undefined
  }
}

export async function fetchCandidateMetadata(
  repo: { owner: string; name: string },
  opts: { fetch?: FetchLike; signal?: AbortSignal } = {},
): Promise<CandidateMeta | undefined> {
  const repoPkg = await fetchRepoPackageJson(repo, opts)
  if (repoPkg === undefined || typeof repoPkg.name !== 'string') return undefined
  const isBundle = repoPkg.dsh?.bundle !== undefined
  const npm = await fetchNpmLatest(repoPkg.name, opts)
  if (npm !== undefined) {
    return { packageName: repoPkg.name, version: npm.version, peers: npm.peers ?? repoPkg.peerDependencies, isBundle, source: 'npm' }
  }
  if (typeof repoPkg.version !== 'string') return undefined
  return { packageName: repoPkg.name, version: repoPkg.version, peers: repoPkg.peerDependencies, isBundle, source: 'github' }
}
