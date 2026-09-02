import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EXPECTED_MIGRATION_TRANSITIONS,
  expectedMigrationTransitions,
  validateWindowsPhysicalAcceptanceReport,
} from './windows-physical-acceptance-report.mjs'

const commit = '4626c5bcc11352ada66131636d7a5f66cd4ad53b'
const baselineCommit = '80c3a5a1a116a0bc2fd5352b9fee2afc58207f15'
const digest = 'a'.repeat(64)

function validReportV1() {
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

function validReportV2() {
  const report = validReportV1()
  report.version = 2
  report.migrationBaseline = {
    commit: baselineCommit,
    productVersion: '0.9.19',
    fileVersion: '0.9.19',
  }
  report.candidate.productVersion = '1.0.0-rc.7'
  report.candidate.fileVersion = '1.0.0.7'
  report.profiles.clean.cliVersion = '1.0.0-rc.7'
  report.profiles.migration.transitions = [
    ...expectedMigrationTransitions('0.9.19', '1.0.0.7'),
  ]
  return report
}

function setNotRunProfiles(report) {
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
}

test('accepts the historical v1 physical acceptance report', () => {
  const report = validReportV1()
  assert.equal(validateWindowsPhysicalAcceptanceReport(report, { expectedCommit: commit }), report)
})

test('accepts a v2 report with explicit migration authority', () => {
  const report = validReportV2()
  assert.equal(validateWindowsPhysicalAcceptanceReport(report, { expectedCommit: commit }), report)
})

test('derives v2 transitions from baseline and candidate versions', () => {
  assert.deepEqual(expectedMigrationTransitions('0.9.19', '1.0.0.7'), [
    'installed-0.9.19',
    'upgraded-1.0.0.7',
    'reinstalled-1.0.0.7',
    'uninstalled-for-rollback',
    'rolled-back-0.9.19',
    're-upgraded-1.0.0.7',
    'uninstalled',
  ])
})

test('rejects equal baseline and candidate file versions', () => {
  assert.throws(() => expectedMigrationTransitions('0.9.19', '0.9.19'), /must differ/)
})

test('rejects a report bound to another source commit', () => {
  const report = validReportV2()
  assert.throws(
    () => validateWindowsPhysicalAcceptanceReport(report, { expectedCommit: 'b'.repeat(40) }),
    /source commit/,
  )
})

test('requires a concrete ZIP artifact name and digest', () => {
  const report = validReportV2()
  report.candidate.artifactName = 'metrora-windows-candidate'
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /ZIP name/)
  report.candidate.artifactName = `metrora-windows-candidate-${commit}.zip`
  report.candidate.artifactSha256 = null
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /artifact digest/)
})

test('requires an explicit valid v2 migration baseline', () => {
  const report = validReportV2()
  delete report.migrationBaseline
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /fields are invalid/)

  const invalid = validReportV2()
  invalid.migrationBaseline.commit = 'invalid'
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(invalid), /baseline commit/)
})

test('rejects a candidate file version that contradicts version authority', () => {
  const report = validReportV2()
  report.candidate.fileVersion = '1.0.0.8'
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /version authority/)
})

test('rejects path-shaped platform text', () => {
  const report = validReportV2()
  report.platform.edition = 'C:\\Users\\fixture'
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /without paths/)
})

test('rejects private-data declarations', () => {
  const report = validReportV2()
  report.privacy.containsWorkspaceIdentifiers = true
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /must remain false/)
})

test('rejects a passing existing profile with duplicate production', () => {
  const report = validReportV2()
  report.profiles.existing.duplicateProductionCount = 1
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /duplicate production/)
})

test('rejects a passing clean profile with ambiguous registration authority', () => {
  const report = validReportV2()
  report.profiles.clean.registrationCount = 2
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /one registration/)
})

test('rejects a passing clean profile with a different CLI version', () => {
  const report = validReportV2()
  report.profiles.clean.cliVersion = '0.9.19'
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /current CLI version/)
})

test('rejects a v2 migration sequence for the wrong candidate', () => {
  const report = validReportV2()
  report.profiles.migration.transitions = [...EXPECTED_MIGRATION_TRANSITIONS]
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /complete declared transition/)
})

test('allows explicitly not-run profiles without manufacturing evidence', () => {
  const report = validReportV2()
  setNotRunProfiles(report)
  assert.equal(validateWindowsPhysicalAcceptanceReport(report), report)
})

test('rejects evidence claims on not-run profiles', () => {
  const report = validReportV2()
  setNotRunProfiles(report)
  report.profiles.existing.portableVerified = true
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /not-run forbids portable evidence/)

  setNotRunProfiles(report)
  report.profiles.clean.registrationCount = 1
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /not-run requires zero registrations/)

  setNotRunProfiles(report)
  report.profiles.migration.transitions = ['installed-0.9.19']
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /not-run forbids transitions/)
})

test('rejects unknown fields rather than accepting future private content', () => {
  const report = validReportV2()
  report.notes = 'private path or identifier could leak here'
  assert.throws(() => validateWindowsPhysicalAcceptanceReport(report), /fields are invalid/)
})
