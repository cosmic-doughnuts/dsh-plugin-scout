import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRegistry, searchCurated } from '../lib/registry.js'

const FIXTURE = {
  categories: { notify: { en: 'Notifications', zh: '通知' } },
  plugins: [
    { name: 'dsh-wechat-notify', owner: 'a', url: 'https://github.com/a/dsh-wechat-notify',
      description: { en: 'WeChat notifications when tasks finish', zh: '任务完成后微信通知' }, stars: 10, category: 'notify',
      install: 'dsh plugin --profile web add dsh-wechat-notify' },
    { name: 'dsh-generic-hook', owner: 'b', url: 'https://github.com/b/dsh-generic-hook',
      description: { en: 'webhook plumbing', zh: 'webhook 管道' }, stars: 99, category: 'notify',
      install: 'dsh plugin --profile web add dsh-generic-hook' },
    { name: 'dsh-theme-dark', owner: 'c', url: 'https://github.com/c/dsh-theme-dark',
      description: { en: 'A dark theme', zh: '深色主题' }, stars: 5, category: 'theme',
      install: 'dsh plugin --profile web add dsh-theme-dark' },
  ],
}

test('searchCurated ranks strong matches above weak, respects limit', () => {
  const hits = searchCurated(FIXTURE, 'wechat', 8, 'en')
  assert.deepEqual(hits.map(p => p.name), ['dsh-wechat-notify'])
  // weak description match only
  const weak = searchCurated(FIXTURE, 'webhook plumbing', 8, 'en')
  assert.deepEqual(weak.map(p => p.name), ['dsh-generic-hook'])
  // no match
  assert.deepEqual(searchCurated(FIXTURE, 'kubernetes', 8, 'en'), [])
  // limit
  const all = searchCurated(FIXTURE, 'dsh', 2, 'en')
  assert.equal(all.length, 2)
  assert.equal(all.length, new Set(all.map(p => p.name)).size)
})

test('searchCurated prefers zh description when lang=zh', () => {
  const [hit] = searchCurated(FIXTURE, '微信', 8, 'zh')
  assert.equal(hit.name, 'dsh-wechat-notify')
})

test('loadRegistry: network success writes cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scout-reg-'))
  try {
    const f = async () => ({ ok: true, status: 200, json: async () => FIXTURE, text: async () => '' })
    const { registry, source } = await loadRegistry({ fetch: f, cacheDir: dir })
    assert.equal(source, 'network')
    assert.equal(registry.plugins.length, 3)
    // now fail the network: cache must serve
    const bad = async () => { throw new Error('offline') }
    const cached = await loadRegistry({ fetch: bad, cacheDir: dir })
    assert.equal(cached.source, 'cache')
    assert.equal(cached.registry.plugins.length, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadRegistry: nothing available returns empty registry without throwing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scout-reg-'))
  try {
    const bad = async () => { throw new Error('offline') }
    const { registry, source } = await loadRegistry({ fetch: bad, cacheDir: dir })
    assert.equal(source, 'bundled')
    assert.deepEqual(registry.plugins, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
