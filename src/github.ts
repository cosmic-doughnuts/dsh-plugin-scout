/** Live GitHub repository search scoped to the public `dsh-plugin` topic,
 * ranked by stars, with a single retry on rate limits and a 5-minute
 * per-query cache keyed by query and token presence. */

export interface GitHubRepo { name: string; owner: string; url: string; description: string; stars: number }

export class GitHubSearchRateLimited extends Error {}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; repos: GitHubRepo[] }>()

let testFetch: FetchLike | undefined

/** Test seam: inject a fetch implementation (all modules share this need; only this one has network). */
export function __setFetchForTests(f: FetchLike | undefined): void {
  testFetch = f
}

/** Test seam: drop the per-query cache. */
export function __clearCacheForTests(): void {
  cache.clear()
}

async function fetchOnce(query: string, perPage: number, token: string | undefined, signal: AbortSignal | undefined, f: FetchLike): Promise<GitHubRepo[]> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:dsh-plugin ${query}`)}&per_page=${perPage}`
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token !== undefined && token !== '') headers.Authorization = `Bearer ${token}`
  const res = await f(url, { headers, signal })
  if (res.status === 403 || res.status === 429) {
    const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }))
    throw new GitHubSearchRateLimited(`GitHub search rate limited (HTTP ${res.status}): ${(body as { message?: string }).message ?? ''}`)
  }
  if (!res.ok) throw new Error(`GitHub search failed: HTTP ${res.status}`)
  const data = await res.json() as { items?: Array<{ full_name?: string; stargazers_count?: number; html_url?: string; description?: string | null }> }
  return (data.items ?? [])
    .filter(item => typeof item.full_name === 'string' && item.full_name.includes('/'))
    .map(item => {
      const [owner, name] = (item.full_name as string).split('/')
      return {
        owner, name,
        url: String(item.html_url ?? `https://github.com/${item.full_name}`),
        description: item.description ?? '',
        stars: Number(item.stargazers_count ?? 0),
      }
    })
    .sort((a, b) => b.stars - a.stars)
}

export async function searchGitHub(
  query: string,
  limit: number,
  opts: { token?: string; signal?: AbortSignal; fetch?: FetchLike; now?: () => number } = {},
): Promise<GitHubRepo[]> {
  const f = opts.fetch ?? testFetch ?? (globalThis.fetch as unknown as FetchLike)
  const now = opts.now ?? Date.now
  const key = `${query}|${opts.token !== undefined && opts.token !== '' ? 't' : 'a'}`
  const hit = cache.get(key)
  if (hit !== undefined && now() - hit.at < CACHE_TTL_MS) return hit.repos

  const perPage = Math.min(limit * 3, 30)
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const repos = await fetchOnce(query, perPage, opts.token, opts.signal, f)
      cache.set(key, { at: now(), repos })
      return repos
    } catch (error) {
      lastError = error
      if (!(error instanceof GitHubSearchRateLimited) && attempt === 0) continue // network error: retry once
      if (error instanceof GitHubSearchRateLimited && attempt === 0) continue    // rate limit: retry once
      throw error
    }
  }
  throw lastError
}
