import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePlugin, fetchCandidateMetadata } from '../lib/compat.js'

const RT = { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-tools': '0.2.0-rc.2' }

test('motivating case: 0.1.x peers vs 0.2.0-rc.2 runtime', () => {
  const v = evaluatePlugin({ '@deepseek-ai/cordis': '^4.0.1', '@deepseek-ai/dsh-tools': '^0.1.0-rc.6 || ^0.1.7-alpha.1' }, RT)
  assert.equal(v.status, 'incompatible')
  assert.ok(v.reasons[0].includes('@deepseek-ai/dsh-tools'))
  assert.ok(v.reasons[0].includes('^0.1.0-rc.6 || ^0.1.7-alpha.1'))
})

test('compatible when all runtime peers satisfied', () => {
  assert.equal(evaluatePlugin({ '@deepseek-ai/cordis': '^4.0.1', '@deepseek-ai/dsh-tools': '^0.2.0-rc.2' }, RT).status, 'compatible')
})

test('unknown when no runtime peer is declared', () => {
  assert.equal(evaluatePlugin({ react: '^18' }, RT).status, 'unknown')
})

test('unknown when peers undefined', () => {
  assert.equal(evaluatePlugin(undefined, RT).status, 'unknown')
})

test('unknown for unsupported range syntax instead of wrong incompatible', () => {
  assert.equal(evaluatePlugin({ '@deepseek-ai/dsh-tools': '*' }, RT).status, 'unknown')
})

test('unknown when a declared runtime package has no known runtime version', () => {
  assert.equal(evaluatePlugin({ '@deepseek-ai/dsh-settings': '^9' }, RT).status, 'unknown')
})

const PKG = JSON.stringify({ name: 'dsh-example', version: '1.2.0',
  peerDependencies: { '@deepseek-ai/dsh-tools': '^0.2.0-rc.2' }, dsh: { bundle: { patch: './cordis.patch.yml' } } })

test('fetchCandidateMetadata prefers npm latest and reads dsh.bundle from repo', async () => {
  const npmMeta = { 'dist-tags': { latest: '1.3.0' }, versions: { '1.3.0': {} } }
  const f = async (url) => ({
    ok: true, status: 200,
    json: async () => (url.includes('registry.npmjs.org') ? npmMeta
      : url.includes('/master/') || url.includes('/main/') ? JSON.parse(PKG) : {}),
    text: async () => '404: Not Found',
  })
  const meta = await fetchCandidateMetadata({ owner: 'o', name: 'r' }, { fetch: f })
  assert.equal(meta.source, 'npm'); assert.equal(meta.version, '1.3.0')
  assert.equal(meta.isBundle, true); assert.equal(meta.peers['@deepseek-ai/dsh-tools'], '^0.2.0-rc.2')
})

test('fetchCandidateMetadata returns undefined when repo package.json is unreachable', async () => {
  const f = async () => ({ ok: false, status: 404, json: async () => { throw new Error('no') }, text: async () => '' })
  assert.equal(await fetchCandidateMetadata({ owner: 'o', name: 'r' }, { fetch: f }), undefined)
})
