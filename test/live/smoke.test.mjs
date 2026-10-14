import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchGitHub, GitHubSearchRateLimited } from '../../lib/github.js'
import { fetchCandidateMetadata, resolveRuntimeVersions } from '../../lib/compat.js'

test('live: GitHub topic search returns dsh-plugin repos', async (t) => {
  try {
    const repos = await searchGitHub('theme', 8, { signal: AbortSignal.timeout(15000) })
    assert.ok(Array.isArray(repos))
  } catch (error) {
    if (error instanceof GitHubSearchRateLimited) return t.diagnostic('rate limited — skipped')
    throw error
  }
})

test('live: dsh-find-plugin candidate is incompatible with this runtime', async (t) => {
  const runtime = await resolveRuntimeVersions()
  t.diagnostic(`runtime: ${JSON.stringify(runtime)}`)
  const meta = await fetchCandidateMetadata({ owner: 'awesome-dsh-plugin', name: 'dsh-find-plugin' })
  if (meta === undefined) return t.diagnostic('metadata unreachable — skipped')
  const { evaluatePlugin } = await import('../../lib/compat.js')
  const verdict = evaluatePlugin(meta.peers, runtime)
  t.diagnostic(`dsh-find-plugin@${meta.version}: ${verdict.status} ${verdict.reasons.join('; ')}`)
  if (Object.keys(runtime).length > 0) assert.equal(verdict.status, 'incompatible')
})
