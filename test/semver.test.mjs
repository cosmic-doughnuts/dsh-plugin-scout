import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVersion, satisfies } from '../lib/semver.js'

test('parseVersion', () => {
  assert.deepEqual(parseVersion('0.2.0-rc.2'), { major: 0, minor: 2, patch: 0, pre: ['rc', '2'] })
  assert.deepEqual(parseVersion('4.0.4'), { major: 4, minor: 0, patch: 4, pre: [] })
  assert.equal(parseVersion('v1.2.3'), undefined)   // no leading v in peers
  assert.equal(parseVersion('1.2'), undefined)
})

test('satisfies table', () => {
  const cases = [
    // [version, range, expected]  false=definitely not, true=definitely yes, undefined=unsupported
    ['0.2.0-rc.2', '0.2.0-rc.2', true],
    ['0.2.0-rc.3', '^0.2.0-rc.2', true],       // prerelease above floor, same 0.2.x
    ['0.2.0', '^0.2.0-rc.2', true],            // release beats its own prerelease
    // cross-patch prereleases match only same-tuple comparators (strict
    // semver): definitively not satisfied
    ['0.2.5-rc.1', '^0.2.0-rc.2', false],
    ['0.2.5-rc.1', '^0.2.1', false],
    ['0.1.9-rc.1', '^0.1.7-alpha.1', false],
    ['0.3.0', '^0.2.0-rc.2', false],
    ['0.1.9', '^0.2.0-rc.2', false],
    ['0.2.0-rc.1', '^0.2.0-rc.2', false],
    ['0.2.0-rc.2', '^0.1.0-rc.6 || ^0.1.7-alpha.1', false],  // the motivating case
    ['0.1.7', '^0.1.0-rc.6 || ^0.1.7-alpha.1', true],
    ['4.0.4', '^4.0.1', true],
    ['4.0.0', '^4.0.1', false],
    ['5.0.0', '^4.0.1', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],                // 0.0.x caret pins the patch
    ['0.1.5', '^0.1.5', true],
    ['0.1.4', '^0.1.5', false],
    ['1.0.0', '*', undefined],
    ['1.0.0', '>=1.0.0', undefined],
    ['1.0.0', '1.x', undefined],
    ['1.0.0', '~1.0.0', undefined],
    ['1.0.0', '', undefined],
  ]
  for (const [v, r, expected] of cases) assert.equal(satisfies(v, r), expected, `${v} vs ${r}`)
})
