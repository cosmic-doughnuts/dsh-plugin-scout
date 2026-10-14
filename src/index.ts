/**
 * dsh-plugin-scout — find DSH plugins inside the agent, with peer-range
 * compatibility verdicts against the running dsh runtime.
 *
 * Registers the `find_dsh_plugin` tool: a live GitHub search over the public
 * `dsh-plugin` topic, ranked by stars; each plugin candidate's package
 * metadata is resolved from the npm registry (or the repo) and its declared
 * DSH peer ranges are evaluated against the running runtime, producing a
 * compatible / incompatible / unknown verdict. Installation is delegated to
 * the built-in `plugin_manager` tool or the `dsh plugin` CLI.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { searchGitHub, GitHubSearchRateLimited, __setFetchForTests as ghTestFetch } from './github.js'
import { loadRegistry, searchCurated } from './registry.js'
import { fetchCandidateMetadata, evaluatePlugin, resolveRuntimeVersions, type Verdict, type RuntimeVersions } from './compat.js'

export const name = 'dsh-plugin-scout'
export const inject = ['tools']

/** DSH credential name for authenticated GitHub search (optional). */
const GITHUB_TOKEN_REF = 'GITHUB_TOKEN'
const DESCRIPTION_MAX_CHARS = 240

let runtimeOverride: RuntimeVersions | undefined

/** Test seam: pin the runtime versions instead of resolving them. */
export function __setRuntimeForTests(v: RuntimeVersions | undefined): void {
  runtimeOverride = v
}

export { ghTestFetch }

type FindItem = {
  name: string
  url: string
  description: string
  stars: number
  packageName?: string
  verdict: Verdict
  install: string
}

type FindResult = { results: FindItem[]; notBundles: string[]; note: string }

function truncate(text: string, max: number): string {
  const value = String(text ?? '').replace(/\s+/gu, ' ').trim()
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

const MARKER: Record<Verdict['status'], string> = { compatible: '✅', incompatible: '❌', unknown: '❓' }

function renderText(result: FindResult): string {
  const lines = result.results.map((m, i) => {
    const reasons = m.verdict.reasons.length > 0 ? `\n   ${m.verdict.reasons.join('; ')}` : ''
    return `${i + 1}. ${m.name} ★${m.stars} ${MARKER[m.verdict.status]} — ${m.description}\n   ${m.url}\n   install: ${m.install}${reasons}`
  })
  const foot = result.notBundles.length > 0
    ? `\n\nOn the topic but not DSH plugin bundles (no dsh.bundle manifest): ${result.notBundles.join(', ')}`
    : ''
  const note = result.note ? `\n\n${result.note}` : ''
  const warning = result.results.length > 0
    ? '\n\nPlugins are third-party code that runs with your permissions — review the source and pin a commit before installing.'
    : ''
  return (lines.length > 0 ? lines.join('\n\n') : 'No matching DSH plugins found.') + foot + note + warning
}

async function resolveGitHubToken(ctx: Context): Promise<string | undefined> {
  try {
    const credentials = typeof ctx.get === 'function'
      ? (ctx.get('credentials') as { resolve?: (ref: string) => Promise<{ value?: string } | undefined> } | undefined)
      : undefined
    if (credentials === undefined || typeof credentials.resolve !== 'function') return undefined
    const resolved = await credentials.resolve(GITHUB_TOKEN_REF)
    const value = resolved?.value
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'find_dsh_plugin',
    description:
      'Search GitHub for DeepSeek Harness plugins (public `dsh-plugin` topic), ranked by stars, and check each ' +
      "candidate's declared DSH peer ranges against the running dsh runtime: every result is marked ✅ compatible, " +
      '❌ incompatible (with the unsatisfied ranges), or ❓ unknown. Use when the user wants a capability DSH does not ' +
      'currently have, or asks what plugins exist. Install with the `plugin_manager` tool (install_bundle action) or the ' +
      'printed `dsh plugin` command; plugins are third-party code — review the source and pin a commit. Falls back to ' +
      'keyword matches from the curated awesome-dsh-plugin list when GitHub search is rate limited or unreachable; the ' +
      'note states which source was used.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Keywords describing the capability, e.g. "wechat notifications", "TUI", "theme"',
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default 8, max 20)',
      },
      lang: {
        type: 'string',
        description: "Preferred description language for curated entries (e.g. 'en', 'zh'). Defaults to 'en'.",
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderText(value as unknown as FindResult) }],
    },
    execute: async (args, exec) => {
      const limit = Math.max(1, Math.min(args.limit ?? 8, 20))
      const lang = args.lang ?? 'en'
      const signal = exec?.signal
      const token = await resolveGitHubToken(ctx)

      let githubError: unknown = null
      let found: Awaited<ReturnType<typeof searchGitHub>> = []
      try {
        found = await searchGitHub(args.query, limit, { token, signal })
      } catch (error) {
        githubError = error
      }

      const curatedDescriptions = new Map<string, Record<string, string>>()
      let registryResult: Awaited<ReturnType<typeof loadRegistry>> | undefined
      try {
        const cacheDir = process.env.DSH_HOME !== undefined
          ? join(process.env.DSH_HOME, 'cache', 'dsh-plugin-scout')
          : join(homedir(), '.dsh', 'cache', 'dsh-plugin-scout')
        registryResult = await loadRegistry({ signal, cacheDir })
        for (const p of registryResult.registry.plugins ?? []) curatedDescriptions.set(p.url.toLowerCase(), p.description)
      } catch { /* curated descriptions are an enhancement only */ }

      if (githubError === null) {
        const runtime: RuntimeVersions = runtimeOverride ?? await resolveRuntimeVersions()
        const notBundles: string[] = []

        const results: FindItem[] = []
        for (let i = 0; i < found.length && results.length < limit; i++) {
          const repo = found[i]
          const meta = await fetchCandidateMetadata(repo, { signal }).catch(() => undefined)
          if (meta === undefined) {
            // metadata unreachable — still report, as unknown
            results.push({
              name: repo.name, url: repo.url, description: truncate(curatedDescriptions.get(repo.url.toLowerCase())?.[lang] ?? repo.description, DESCRIPTION_MAX_CHARS),
              stars: repo.stars, verdict: { status: 'unknown', reasons: ['package metadata unreachable'] },
              install: `dsh plugin --profile <name> add github:${repo.owner}/${repo.name}`,
            })
            continue
          }
          if (!meta.isBundle) {
            notBundles.push(`${repo.owner}/${repo.name}`)
            continue
          }
          results.push({
            name: repo.name,
            url: repo.url,
            description: truncate(curatedDescriptions.get(repo.url.toLowerCase())?.[lang] ?? repo.description, DESCRIPTION_MAX_CHARS),
            stars: repo.stars,
            packageName: meta.packageName,
            verdict: evaluatePlugin(meta.peers, runtime),
            install: `dsh plugin --profile <name> add ${meta.packageName} (or ask the agent to use the plugin_manager tool's install_bundle action)`,
          })
        }
        const note = results.length === 0 && notBundles.length > 0
          ? 'Only non-bundle topic repos matched; try broader keywords or browse https://awesome-dsh-plugin.com'
          : ''
        return { results, notBundles, note } satisfies FindResult
      }

      // Degraded path: GitHub unavailable → curated keyword matches.
      if (registryResult === undefined) throw githubError
      const matches = searchCurated(registryResult.registry, args.query, limit, lang)
      const message = githubError instanceof Error ? githubError.message : String(githubError)
      const reason = githubError instanceof GitHubSearchRateLimited
        ? `GitHub search is rate limited: ${message}`
        : `GitHub search is unavailable: ${message}`
      const note = `${reason}\nFalling back to keyword matches from the curated awesome-dsh-plugin list ` +
        `(source=${registryResult.source}, ${registryResult.registry.plugins?.length ?? 0} entries) — not a live ` +
        'star-ranked GitHub result, and compatibility verdicts are unavailable on this path. Configure the DSH ' +
        '`GITHUB_TOKEN` credential to restore live search (30 req/min authenticated).'
      const results: FindItem[] = matches.map(p => ({
        name: String(p.name ?? ''),
        url: String(p.url ?? ''),
        description: truncate(p.description?.[lang] ?? p.description?.en ?? '', DESCRIPTION_MAX_CHARS),
        stars: Number(p.stars ?? 0),
        verdict: { status: 'unknown', reasons: ['curated fallback: peer compatibility not evaluated'] },
        install: String(p.install ?? `dsh plugin --profile <name> add github:${p.owner}/${p.name}`),
      }))
      return { results, notBundles: [], note } satisfies FindResult
    },
    timeoutMs: 30000,
  }))
}
