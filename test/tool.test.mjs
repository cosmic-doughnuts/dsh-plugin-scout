import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __setFetchForTests as ghFetch, __clearCacheForTests as ghClear } from '../lib/github.js'
import { __setFetchForTests as compatFetch } from '../lib/compat.js'
import { __setFetchForTests as regFetch } from '../lib/registry.js'

const GH_BODY = {
  items: [
    { full_name: 'a/dsh-plugin-one', stargazers_count: 30, html_url: 'https://github.com/a/dsh-plugin-one', description: 'plugin one' },
    { full_name: 'b/dsh-plugin-two', stargazers_count: 20, html_url: 'https://github.com/b/dsh-plugin-two', description: 'plugin two' },
    { full_name: 'c/not-a-plugin', stargazers_count: 10, html_url: 'https://github.com/c/not-a-plugin', description: 'a big app' },
  ],
}

function repoPkg(name, peers, withBundle = true) {
  return { name, version: '1.0.0', peerDependencies: peers, ...(withBundle ? { dsh: { bundle: { patch: './cordis.patch.yml' } } } : {}) }
}

const PKGS = {
  'a/dsh-plugin-one': repoPkg('dsh-plugin-one', { '@deepseek-ai/dsh-tools': '^0.2.0-rc.2' }),
  'b/dsh-plugin-two': repoPkg('dsh-plugin-two', { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' }),
  'c/not-a-plugin': repoPkg('some-app', { react: '^18' }, false),
}

const npmMeta = (name) => ({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } })

function fixtureFetch(opts = {}) {
  return async (url) => {
    if (url.includes('api.github.com/search')) {
      if (opts.ghFail) return { ok: false, status: opts.ghFail, json: async () => ({ message: 'rate limited' }) }
      return { ok: true, status: 200, json: async () => GH_BODY }
    }
    if (url.includes('raw.githubusercontent.com')) {
      const slug = url.replace('https://raw.githubusercontent.com/', '').split('/').slice(0, 2).join('/')
      const pkg = PKGS[slug]
      if (opts.repoFail?.(slug)) return { ok: false, status: 404, json: async () => ({}) }
      if (!pkg) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => pkg }
    }
    if (url.includes('registry.npmjs.org')) {
      const name = url.split('/').pop()
      if (!(name in npmMeta(name))) return { ok: true, status: 200, json: async () => npmMeta(name) }
      return { ok: true, status: 200, json: async () => npmMeta(name) }
    }
    if (url.includes('awesome-dsh-plugin.com')) {
      return { ok: true, status: 200, json: async () => ({ plugins: [], categories: {} }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

let tool
beforeEach(async () => {
  ghClear()
  const { __setRuntimeForTests, apply } = await import('../lib/index.js')
  __setRuntimeForTests({ '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-tools': '0.2.0-rc.2' })
  const captured = {}
  const ctx = { tools: { register(t) { captured.t = t } }, get: () => undefined }
  apply(ctx)
  tool = captured.t
})

test('tool registers as find_dsh_plugin with query parameter', () => {
  assert.equal(tool.name, 'find_dsh_plugin')
  assert.deepEqual(tool.parameters.required, ['query'])
})

test('ranked results keep star order and carry verdicts', async () => {
  ghFetch(fixtureFetch()); compatFetch(fixtureFetch()); regFetch(fixtureFetch())
  const out = await tool.execute({ query: 'anything' })
  assert.deepEqual(out.results.map(r => r.name), ['dsh-plugin-one', 'dsh-plugin-two'])
  assert.equal(out.results[0].verdict.status, 'compatible')
  assert.equal(out.results[1].verdict.status, 'incompatible')
})

test('repo without dsh.bundle goes to the footnote, not results', async () => {
  ghFetch(fixtureFetch()); compatFetch(fixtureFetch()); regFetch(fixtureFetch())
  const out = await tool.execute({ query: 'anything' })
  assert.ok(out.results.every(r => r.name !== 'not-a-plugin'))
  assert.ok(out.notBundles.some(n => n.includes('not-a-plugin')))
})

test('one candidate metadata failure yields unknown without affecting others', async () => {
  ghFetch(fixtureFetch()); compatFetch(fixtureFetch({ repoFail: (s) => s === 'a/dsh-plugin-one' })); regFetch(fixtureFetch())
  const out = await tool.execute({ query: 'anything' })
  const byName = Object.fromEntries(out.results.map(r => [r.name, r]))
  assert.equal(byName['dsh-plugin-one'].verdict.status, 'unknown')
  assert.equal(byName['dsh-plugin-two'].verdict.status, 'incompatible')
})

test('GitHub rate limit degrades to curated fallback with a note', async () => {
  ghFetch(fixtureFetch({ ghFail: 403 })); compatFetch(fixtureFetch()); regFetch(fixtureFetch())
  const out = await tool.execute({ query: 'anything' })
  assert.ok(out.note.toLowerCase().includes('fall'), `note was: ${out.note}`)
  assert.deepEqual(out.results, [])
})

test('render includes install guidance and the third-party-code warning', async () => {
  ghFetch(fixtureFetch()); compatFetch(fixtureFetch()); regFetch(fixtureFetch())
  const out = await tool.execute({ query: 'anything' })
  const [{ type, text }] = tool.output.render({}, out)
  assert.equal(type, 'text')
  assert.ok(text.includes('dsh plugin'))
  assert.ok(text.includes('third-party'))
  assert.ok(text.includes('dsh-plugin-one'))
})
