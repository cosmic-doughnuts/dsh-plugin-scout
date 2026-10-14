/** Curated awesome-dsh-plugin list: network fetch with on-disk cache and a
 * keyword-match fallback search used when live GitHub search is unavailable. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const REGISTRY_URL = 'https://awesome-dsh-plugin.com/plugins.json'

export interface RegistryPlugin {
  name: string
  owner: string
  url: string
  description: Record<string, string>
  stars: number
  category: string
  install: string
}

export interface Registry {
  plugins?: RegistryPlugin[]
  categories?: Record<string, { en: string; zh: string }>
}

export interface RegistryLoadResult { registry: Registry; source: 'network' | 'cache' | 'bundled' }

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

let testFetch: FetchLike | undefined

/** Test seam: inject a fetch implementation. */
export function __setFetchForTests(f: FetchLike | undefined): void {
  testFetch = f
}

const cachePath = (dir: string) => join(dir, 'registry.json')

export async function loadRegistry(opts: { fetch?: FetchLike; cacheDir?: string; signal?: AbortSignal } = {}): Promise<RegistryLoadResult> {
  const f = opts.fetch ?? testFetch ?? (globalThis.fetch as unknown as FetchLike)
  // 1. network
  try {
    const res = await f(REGISTRY_URL, { signal: opts.signal ?? AbortSignal.timeout(8000) })
    if (res.ok) {
      const registry = await res.json() as Registry
      if (opts.cacheDir !== undefined) {
        try {
          await mkdir(dirname(cachePath(opts.cacheDir)), { recursive: true })
          await writeFile(cachePath(opts.cacheDir), JSON.stringify(registry), 'utf8')
        } catch { /* cache write is best-effort */ }
      }
      return { registry, source: 'network' }
    }
  } catch { /* fall through to cache */ }
  // 2. cache
  if (opts.cacheDir !== undefined) {
    try {
      const raw = await readFile(cachePath(opts.cacheDir), 'utf8')
      return { registry: JSON.parse(raw) as Registry, source: 'cache' }
    } catch { /* no cache */ }
  }
  // 3. nothing
  return { registry: { plugins: [] }, source: 'bundled' }
}

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/[\s,，、]+/u).map(part => part.trim()).filter(part => part.length > 0)
}

/** Keyword match against the curated list. Ranking prefers the number of
 * matched query terms, then weighted score, then stars (upstream semantics). */
export function searchCurated(registry: Registry, query: string, limit: number, lang: string): RegistryPlugin[] {
  const tokens = tokenize(query)
  const whole = query.toLowerCase().trim()
  const labels = registry.categories ?? {}
  const scored: Array<{ plugin: RegistryPlugin; score: number; matched: number }> = []

  for (const plugin of registry.plugins ?? []) {
    const label = labels[plugin.category] ?? {}
    const strong = `${plugin.name ?? ''} ${plugin.owner ?? ''} ${plugin.category ?? ''} ${label.en ?? ''} ${label.zh ?? ''} ${plugin.url ?? ''}`.toLowerCase()
    const weak = `${plugin.description?.en ?? ''} ${plugin.description?.zh ?? ''}`.toLowerCase()
    let score = 0
    let matched = 0
    if (whole.length > 0 && (strong.includes(whole) || weak.includes(whole))) {
      score += 4
      matched += 1
    }
    for (const token of tokens) {
      if (strong.includes(token)) {
        score += 3
        matched += 1
      } else if (weak.includes(token)) {
        score += 1
        matched += 1
      }
    }
    if (score > 0) scored.push({ plugin, score, matched })
  }

  scored.sort((a, b) =>
    b.matched - a.matched || b.score - a.score || Number(b.plugin.stars ?? 0) - Number(a.plugin.stars ?? 0))

  return scored.slice(0, limit).map(({ plugin }) => plugin)
}
