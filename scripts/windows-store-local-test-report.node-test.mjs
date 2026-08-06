import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const verifier = new URL('./verify-windows-store-local-test-report.mjs', import.meta.url)
const commit = 'a'.repeat(40)

function validReport() {
  return {
    kind: 'metrora.windows-store-local-test-report',
    version: 1,
    status: 'pass',
    generatedAt: '2026-08-06T18:00:00.000Z',
    source: {
      repository: 'maikolsiragusaa/metrora',
      commit,
    },
    package: {
      artifactName: 'Metrora-1.0.0-rc.7-Windows-Store-x64.appx',
      unsignedSha256: '1'.repeat(64),
      testSignedSha256: '2'.repeat(64),
      version: '1.0.0.7',
      architecture: 'x64',
    },
    platform: {
      edition: 'Windows 11 Pro',
      version: '10.0',
      build: '26100',
      architecture: 'x64',
    },
    observations: {
      launch: 'pass',
      identityPresentation: 'pass',
      localCollection: 'pass',
      noExternalNode: 'pass',
    },
    cleanup: {
      packageRemoved: true,
      certificateRemoved: true,
      privateKeyRemoved: true,
    },
    privacy: {
      containsPrivatePaths: false,
      containsUsernames: false,
      containsPromptsOrResponses: false,
      containsPackageIdentityValues: false,
      containsKeysOrCertificates: false,
    },
    limitations: [
      'local-test-signature',
      'not-store-signed',
      'not-submitted',
      'not-published',
      'single-windows-host',
      'no-update-flight',
    ],
  }
}

function verify(report, extra = []) {
  const directory = mkdtempSync(join(tmpdir(), 'metrora-store-report-'))
  const path = join(directory, 'report.json')
  writeFileSync(path, JSON.stringify(report))
  return spawnSync(process.execPath, [
    verifier.pathname,
    path,
    '--expected-commit',
    commit,
    ...extra,
  ], { encoding: 'utf8' })
}

test('accepts a complete passing report', () => {
  const result = verify(validReport(), ['--require-pass'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).status, 'pass')
})

test('accepts a consistent failure unless pass is required', () => {
  const report = validReport()
  report.status = 'fail'
  report.observations.localCollection = 'fail'
  assert.equal(verify(report).status, 0)
  assert.notEqual(verify(report, ['--require-pass']).status, 0)
})

test('rejects extra fields that could leak local data', () => {
  const report = validReport()
  report.username = 'example'
  assert.notEqual(verify(report).status, 0)
})

test('rejects an unchanged unsigned digest', () => {
  const report = validReport()
  report.package.testSignedSha256 = report.package.unsignedSha256
  assert.notEqual(verify(report).status, 0)
})

test('rejects contradictory pass status', () => {
  const report = validReport()
  report.cleanup.certificateRemoved = false
  assert.notEqual(verify(report).status, 0)
})

test('rejects package identity material in the report schema', () => {
  const report = validReport()
  report.package.publisher = 'not-allowed'
  assert.notEqual(verify(report).status, 0)
})
