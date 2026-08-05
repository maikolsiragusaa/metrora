import assert from 'node:assert/strict'
import test from 'node:test'

import { validateWindowsUxAcceptanceReport } from './windows-ux-acceptance-report.mjs'

const commit = 'e1e0a4d980bb1f6d6912303155c6291196dea00b'
const digest = 'a'.repeat(64)

function passMatrix(fields) {
  return Object.fromEntries([['status', 'pass'], ...fields.map(field => [field, true])])
}

function validReport() {
  return {
    kind: 'metrora.windows-ux-acceptance-report',
    version: 1,
    generatedAt: '2026-08-04T16:00:00.000Z',
    source: { repository: 'maikolsiragusaa/metrora', commit },
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
    observations: {
      keyboard: passMatrix([
        'forwardFocusOrder',
        'reverseFocusOrder',
        'enterAndSpaceActivation',
        'escapeDismissal',
        'shortcutRouting',
        'focusVisible',
      ]),
      scaling: {
        status: 'pass',
        scales: [100, 125, 150, 200].map(scale => ({
          scale,
          homeUnderstandable: true,
          navigationReachable: true,
          denseReportsLegible: true,
          workspaceActionsVisible: true,
          overlaysContained: true,
          narrowWindowOperable: true,
        })),
      },
      themes: passMatrix([
        'lightThemeContrast',
        'darkThemeContrast',
        'statusMeaningPreserved',
        'signalOrangeNotSoleCarrier',
      ]),
      motion: passMatrix([
        'nonEssentialMotionSuppressed',
        'loadingUnderstandable',
        'stateChangesUnderstandable',
      ]),
      narrator: passMatrix([
        'navigationUnderstood',
        'denseTablesUnderstood',
        'compareWinnerUnderstood',
        'workspaceGuidanceUnderstood',
        'dialogsUnderstood',
      ]),
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
      'manual-visual-observation',
    ],
  }
}

test('accepts a complete source-bound sanitized PASS report', () => {
  const report = validReport()
  assert.equal(validateWindowsUxAcceptanceReport(report, { expectedCommit: commit }), report)
})

test('rejects a different source commit', () => {
  assert.throws(
    () => validateWindowsUxAcceptanceReport(validReport(), { expectedCommit: 'b'.repeat(40) }),
    /source commit/,
  )
})

test('rejects PASS when one keyboard observation is false', () => {
  const report = validReport()
  report.observations.keyboard.focusVisible = false
  assert.throws(() => validateWindowsUxAcceptanceReport(report), /keyboard PASS requires every observation/)
})

test('requires the complete ordered scaling matrix', () => {
  const report = validReport()
  report.observations.scaling.scales[1].scale = 150
  assert.throws(() => validateWindowsUxAcceptanceReport(report), /ordered 100, 125, 150, 200/)
})

test('rejects a scaling PASS with one failed viewport observation', () => {
  const report = validReport()
  report.observations.scaling.scales[3].narrowWindowOperable = false
  assert.throws(() => validateWindowsUxAcceptanceReport(report), /scaling PASS requires every scale observation/)
})

test('allows a closed-schema incomplete draft only when requested', () => {
  const report = validReport()
  report.observations.motion = {
    status: 'not-run',
    nonEssentialMotionSuppressed: false,
    loadingUnderstandable: false,
    stateChangesUnderstandable: false,
  }
  assert.equal(validateWindowsUxAcceptanceReport(report, { requirePass: false }), report)
  assert.throws(() => validateWindowsUxAcceptanceReport(report), /observations.motion must pass/)
})

test('rejects private-data declarations and unknown fields', () => {
  const report = validReport()
  report.privacy.containsWorkspaceIdentifiers = true
  assert.throws(() => validateWindowsUxAcceptanceReport(report), /must remain false/)

  const reportWithNotes = validReport()
  reportWithNotes.notes = 'could leak a path or identifier'
  assert.throws(() => validateWindowsUxAcceptanceReport(reportWithNotes), /fields are invalid/)
})
