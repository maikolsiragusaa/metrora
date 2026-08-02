import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EXPECTED_MIGRATION_TRANSITIONS,
  validateWindowsPhysicalAcceptanceReport,
} from './windows-physical-acceptance-report.mjs'

const commit = '4626c5bcc11352ada66131636d7a5f66cd4ad53b'
const digest = 'a'.repeat(64)

function validReport() {
  return {
    kind: 'metrora.windows-physical-acceptance-report',
    version: 1,
    generatedAt: '2026-08-02T17:00:00.000Z',
    source: {
      repository: 'maikolsiragusaa/metrora',
      commit,
    },
    candidate: {
      artifactName: `metrora-windows-candidate-${commit}.zip`,
      artifactSha256: digest,
      productVersion: '0.9.19',
      releaseManifestSha256: digest,
      formatManifestSha256: digest,
    },
    platform: {
      edition: 'Microsoft Windows 11 Pro',
      version: '10.0.26100',
      build: '26100',
      architecture: 'x64',
    },
    profiles: {
      existing: {
        status: 'pass',
        portableVerified: true,
        identityPreserved: true,
        workspacePreserved: true,
        lifecyclePreserved: true,
        evidencePreserved: true,
        reopenPassed: true,
        recoveryMode: 'explicit-only',
        duplicateProductionCount: 0,
        duplicateBatchCount: 0,
        invalidCount: 0,
        quarantinedCount: 0,
      },
      clean: {
        status: 'pass',
        registrationCount: 1,
        shortcutCount: 1,
        cliVersion: '0.9.19',
        firstLaunchPassed: true,
        uninstallPassed: true,
        sentinelPreserved: true,
      },
      migration: {
        status: 'pass',
        transitions: [...EXPECTED_MIGRATION_TRANSITIONS],
        sentinelPreserved: true,
        fixtureRemoved: true,
      },
    },
    privacy: {
      containsPrivatePaths: false,
      containsUsernames: false,
      containsPromptsOrResponses: false,
      containsWorkspaceIdentifiers: false,
      containsKeysOrEvidence: false,
    },
    limitations: [
      'unsigned-candidate',
      'no-official-release',
      'no-update-channel',
      'single-windows-host',
      'historical-fixture-local-only',
    ],
  }
}

test('accepts the complete sanitized physical acceptance report', () => {
  const report = validReport()
  assert.equal(validateWindowsPhysicalAcceptanceReport(report, { expectedCommit: commit }), report)
})

test('rejects a report bound to another source commit', () => {
  const report = validReport()
  assert.throws(
    () => validateWindowsPhysicalAcceptanceReport(report, { expectedCommit: 'b'.repeat(40) }),
    /source commit/,
  )
})

test('rejects path-shaped platform text', () => {
  const report = validReport()
  report.platform.edition = 'C:\\Users\\private'
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /without paths/)
})

test('rejects private-data declarations', () => {
  const report = validReport()
  report.privacy.containsWorkspaceIdentifiers = true
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /must remain false/)
})

test('rejects a passing existing profile with duplicate production', () => {
  const report = validReport()
  report.profiles.existing.duplicateProductionCount = 1
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /duplicate production/)
})

test('rejects a passing clean profile with ambiguous registration authority', () => {
  const report = validReport()
  report.profiles.clean.registrationCount = 2
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /one registration/)
})

test('rejects a passing clean profile with a different CLI version', () => {
  const report = validReport()
  report.profiles.clean.cliVersion = '0.9.18'
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /current CLI version/)
})

test('rejects an incomplete passing migration sequence', () => {
  const report = validReport()
  report.profiles.migration.transitions.pop()
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /complete declared transition/)
})

test('allows explicitly not-run profiles without manufacturing PASS evidence', () => {
  const report = validReport()
  report.profiles.existing = {
    status: 'not-run',
    portableVerified: false,
    identityPreserved: false,
    workspacePreserved: false,
    lifecyclePreserved: false,
    evidencePreserved: false,
    reopenPassed: false,
    recoveryMode: 'not-run',
    duplicateProductionCount: 0,
    duplicateBatchCount: 0,
    invalidCount: 0,
    quarantinedCount: 0,
  }
  report.profiles.clean = {
    status: 'not-run',
    registrationCount: 0,
    shortcutCount: 0,
    cliVersion: null,
    firstLaunchPassed: false,
    uninstallPassed: false,
    sentinelPreserved: false,
  }
  report.profiles.migration = {
    status: 'not-run',
    transitions: [],
    sentinelPreserved: false,
    fixtureRemoved: false,
  }
  assert.equal(validateWindowsPhysicalAcceptanceReport(report), report)
})

test('rejects unknown fields rather than accepting future private content', () => {
  const report = validReport()
  report.notes = 'private path or identifier could leak here'
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /fields are invalid/)
})
