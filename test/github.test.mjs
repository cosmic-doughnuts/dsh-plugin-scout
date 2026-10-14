import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchGitHub, GitHubSearchRateLimited } from '../lib/github.js'

const BODY = {
  total_count: 3,
  items: [
    { full_name: 'a/dsh-x', stargazers_count: 10, html_url: 'https://github.com/a/dsh-x', description: 'does x' },
    { full_name: 'b/dsh-y', stargazers_count: 20, html_url: 'https://github.com/b/dsh-y', description: null },
    { full_name: 'c/dsh-z', stargazers_count: 5, html_url: 'https://github.com/c/dsh-z', description: 'does z' },
  ],
}

test('searchGitHub maps repos and sorts by stars', async () => {
  let calls = 0
  const f = async () => { calls++; return { ok: true, status: 200, json: async () => BODY } }
  const repos = await searchGitHub('theme', 8, { fetch: f })
  assert.equal(calls, 1)
  assert.deepEqual(repos.map(r => r.name), ['dsh-y', 'dsh-x', 'dsh-z'])
  assert.equal(repos[0].owner, 'b')
  assert.equal(repos[0].url, 'https://github.com/b/dsh-y')
  assert.equal(repos[0].description, '')
})

test('searchGitHub retries once on 403 then raises GitHubSearchRateLimited', async () => {
  let calls = 0
  const f = async () => { calls++; return { ok: false, status: 403, json: async () => ({ message: 'rate limited' }) } }
  await assert.rejects(searchGitHub('q', 8, { fetch: f }), GitHubSearchRateLimited)
  assert.equal(calls, 2)
})

test('searchGitHub caches per query for 5 minutes, keyed by token presence', async () => {
  let calls = 0
  let t = 1_000_000
  const f = async () => { calls++; return { ok: true, status: 200, json: async () => BODY } }
  const now = () => t
  await searchGitHub('same', 8, { fetch: f, now })
  await searchGitHub('same', 8, { fetch: f, now })           // cached
  assert.equal(calls, 1)
  await searchGitHub('same', 8, { fetch: f, now, token: 'x' }) // different token bucket
  assert.equal(calls, 2)
  t += 301_000                                                 // > 5 min
  await searchGitHub('same', 8, { fetch: f, now })
  assert.equal(calls, 3)
})
