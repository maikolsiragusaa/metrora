import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  buildVersionFor,
  compareMetroraVersions,
  parseMetroraVersion,
} from './version-authority-lib.mjs'

test('orders the historical baseline before the first independent candidate', () => {
  assert.equal(compareMetroraVersions('0.9.19', '1.0.0-rc.1'), -1)
  assert.equal(compareMetroraVersions('1.0.0-rc.1', '0.9.19'), 1)
})

test('orders release candidates before the stable release', () => {
  assert.equal(compareMetroraVersions('1.0.0-rc.1', '1.0.0-rc.2'), -1)
  assert.equal(compareMetroraVersions('1.0.0-rc.2', '1.0.0'), -1)
  assert.equal(compareMetroraVersions('1.0.0', '1.0.0'), 0)
})

test('maps public versions to monotonic numeric platform versions', () => {
  assert.equal(buildVersionFor('1.0.0-rc.1'), '1.0.0.1')
  assert.equal(buildVersionFor('1.0.0-rc.9999'), '1.0.0.9999')
  assert.equal(buildVersionFor('1.0.0'), '1.0.0.10000')
  assert.equal(buildVersionFor('1.0.1-rc.1'), '1.0.1.1')
})

test('exposes the same authority to release scripts', () => {
  const compare = spawnSync(process.execPath, [
    'scripts/compare-metrora-versions.mjs',
    '0.9.19',
    '1.0.0-rc.1',
  ], { encoding: 'utf8' })
  assert.equal(compare.status, 0, compare.stderr)
  assert.equal(compare.stdout.trim(), '-1')

  const build = spawnSync(process.execPath, [
    'scripts/resolve-metrora-build-version.mjs',
    '1.0.0-rc.1',
  ], { encoding: 'utf8' })
  assert.equal(build.status, 0, build.stderr)
  assert.equal(build.stdout.trim(), '1.0.0.1')
})

test('rejects unsupported or unsafe platform version forms', () => {
  for (const value of [
    '1.0.0-rc.0',
    '1.0.0-rc.10000',
    '1.0.0-rc.01',
    '01.0.0',
    '1.0.0-beta.1',
    '65536.0.0',
  ]) {
    assert.throws(() => parseMetroraVersion(value), value)
  }
})
