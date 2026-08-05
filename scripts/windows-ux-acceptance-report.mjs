const sha256Pattern = /^[a-f0-9]{64}$/
const gitSha1Pattern = /^[a-f0-9]{40}$/
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const safeTextPattern = /^[^\\/\r\n\0]{1,160}$/
const artifactNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,195}\.zip$/
const statuses = new Set(['pass', 'fail', 'not-run'])
const expectedScales = [100, 125, 150, 200]
const limitationValues = new Set([
  'unsigned-candidate',
  'no-official-release',
  'no-update-channel',
  'single-windows-host',
  'manual-visual-observation',
])

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} fields are invalid`)
  }
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
}

function assertStatus(value, label) {
  if (!statuses.has(value)) throw new Error(`${label} has unsupported status`)
}

function assertSafeText(value, label) {
  if (typeof value !== 'string' || !safeTextPattern.test(value)) {
    throw new Error(`${label} must be bounded text without paths or line breaks`)
  }
}

function validateBooleanMatrix(value, fields, label) {
  assertExactKeys(value, ['status', ...fields], label)
  assertStatus(value.status, `${label}.status`)
  for (const field of fields) assertBoolean(value[field], `${label}.${field}`)

  if (value.status === 'pass' && fields.some(field => value[field] !== true)) {
    throw new Error(`${label} PASS requires every observation`)
  }
  if (value.status === 'not-run' && fields.some(field => value[field] !== false)) {
    throw new Error(`${label} not-run forbids observations`)
  }
}

function validateScaling(value) {
  assertExactKeys(value, ['status', 'scales'], 'observations.scaling')
  assertStatus(value.status, 'observations.scaling.status')
  if (!Array.isArray(value.scales) || value.scales.length !== expectedScales.length) {
    throw new Error('observations.scaling.scales must contain the complete scale matrix')
  }

  const scaleFields = [
    'homeUnderstandable',
    'navigationReachable',
    'denseReportsLegible',
    'workspaceActionsVisible',
    'overlaysContained',
    'narrowWindowOperable',
  ]
  value.scales.forEach((entry, index) => {
    assertExactKeys(entry, ['scale', ...scaleFields], `observations.scaling.scales[${index}]`)
    if (entry.scale !== expectedScales[index]) {
      throw new Error('observations.scaling scales must be ordered 100, 125, 150, 200')
    }
    for (const field of scaleFields) {
      assertBoolean(entry[field], `observations.scaling.scales[${index}].${field}`)
    }
  })

  const values = value.scales.flatMap(entry => scaleFields.map(field => entry[field]))
  if (value.status === 'pass' && values.some(result => result !== true)) {
    throw new Error('observations.scaling PASS requires every scale observation')
  }
  if (value.status === 'not-run' && values.some(result => result !== false)) {
    throw new Error('observations.scaling not-run forbids observations')
  }
}

export function validateWindowsUxAcceptanceReport(report, options = {}) {
  assertExactKeys(report, [
    'kind',
    'version',
    'generatedAt',
    'source',
    'candidate',
    'platform',
    'observations',
    'privacy',
    'limitations',
  ], 'report')
  if (report.kind !== 'metrora.windows-ux-acceptance-report' || report.version !== 1) {
    throw new Error('report kind or version is unsupported')
  }
  if (typeof report.generatedAt !== 'string' || !timestampPattern.test(report.generatedAt)) {
    throw new Error('generatedAt must be a UTC timestamp')
  }

  assertExactKeys(report.source, ['repository', 'commit'], 'source')
  if (report.source.repository !== 'maikolsiragusaa/metrora' || !gitSha1Pattern.test(report.source.commit)) {
    throw new Error('source authority is invalid')
  }
  if (options.expectedCommit && report.source.commit !== options.expectedCommit) {
    throw new Error('report source commit does not match the expected commit')
  }

  assertExactKeys(report.candidate, [
    'artifactName',
    'artifactSha256',
    'productVersion',
    'releaseManifestSha256',
    'formatManifestSha256',
  ], 'candidate')
  if (!artifactNamePattern.test(report.candidate.artifactName)) {
    throw new Error('candidate artifact name must be a bounded ZIP name')
  }
  if (!sha256Pattern.test(report.candidate.artifactSha256)) {
    throw new Error('candidate artifact digest is invalid')
  }
  if (!semverPattern.test(report.candidate.productVersion)) {
    throw new Error('candidate product version is invalid')
  }
  for (const field of ['releaseManifestSha256', 'formatManifestSha256']) {
    if (!sha256Pattern.test(report.candidate[field])) {
      throw new Error(`candidate ${field} is invalid`)
    }
  }

  assertExactKeys(report.platform, ['edition', 'version', 'build', 'architecture'], 'platform')
  for (const field of ['edition', 'version', 'build', 'architecture']) {
    assertSafeText(report.platform[field], `platform.${field}`)
  }
  if (report.platform.architecture !== 'x64') {
    throw new Error('UX acceptance requires Windows x64')
  }

  assertExactKeys(report.observations, ['keyboard', 'scaling', 'themes', 'motion', 'narrator'], 'observations')
  validateBooleanMatrix(report.observations.keyboard, [
    'forwardFocusOrder',
    'reverseFocusOrder',
    'enterAndSpaceActivation',
    'escapeDismissal',
    'shortcutRouting',
    'focusVisible',
  ], 'observations.keyboard')
  validateScaling(report.observations.scaling)
  validateBooleanMatrix(report.observations.themes, [
    'lightThemeContrast',
    'darkThemeContrast',
    'statusMeaningPreserved',
    'signalOrangeNotSoleCarrier',
  ], 'observations.themes')
  validateBooleanMatrix(report.observations.motion, [
    'nonEssentialMotionSuppressed',
    'loadingUnderstandable',
    'stateChangesUnderstandable',
  ], 'observations.motion')
  validateBooleanMatrix(report.observations.narrator, [
    'navigationUnderstood',
    'denseTablesUnderstood',
    'compareWinnerUnderstood',
    'workspaceGuidanceUnderstood',
    'dialogsUnderstood',
  ], 'observations.narrator')

  assertExactKeys(report.privacy, [
    'containsPrivatePaths',
    'containsUsernames',
    'containsPromptsOrResponses',
    'containsWorkspaceIdentifiers',
    'containsKeysOrEvidence',
  ], 'privacy')
  for (const [field, value] of Object.entries(report.privacy)) {
    if (value !== false) throw new Error(`privacy.${field} must remain false`)
  }

  if (!Array.isArray(report.limitations) || report.limitations.length === 0) {
    throw new Error('limitations must be a non-empty array')
  }
  const unique = new Set(report.limitations)
  if (unique.size !== report.limitations.length || report.limitations.some(value => !limitationValues.has(value))) {
    throw new Error('limitations contain unsupported or duplicate values')
  }
  for (const required of ['unsigned-candidate', 'no-official-release', 'no-update-channel', 'manual-visual-observation']) {
    if (!unique.has(required)) throw new Error(`limitations must include ${required}`)
  }

  if (options.requirePass !== false) {
    for (const [name, observation] of Object.entries(report.observations)) {
      if (observation.status !== 'pass') throw new Error(`observations.${name} must pass`)
    }
  }

  return report
}
