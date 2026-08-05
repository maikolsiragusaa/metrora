const sha256Pattern = /^[a-f0-9]{64}$/
const gitSha1Pattern = /^[a-f0-9]{40}$/
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const safeTextPattern = /^[^\\/\r\n\0]{1,160}$/
const artifactNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,195}\.zip$/
const statuses = new Set(['pass', 'fail', 'not-run'])
const recoveryModes = new Set(['not-required', 'explicit-only', 'failed', 'not-run'])
const limitationValues = new Set([
  'unsigned-candidate',
  'no-official-release',
  'no-update-channel',
  'single-windows-host',
  'historical-fixture-local-only',
])

export const EXPECTED_MIGRATION_TRANSITIONS = Object.freeze([
  'installed-0.9.18',
  'upgraded-0.9.19',
  'reinstalled-0.9.19',
  'uninstalled-for-rollback',
  'rolled-back-0.9.18',
  're-upgraded-0.9.19',
  'uninstalled',
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

function assertSafeText(value, label) {
  if (typeof value !== 'string' || !safeTextPattern.test(value)) {
    throw new Error(`${label} must be bounded text without paths or line breaks`)
  }
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
}

function assertCount(value, label, maximum = 1_000_000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be a bounded non-negative integer`)
  }
}

function assertStatus(value, label) {
  if (!statuses.has(value)) throw new Error(`${label} has unsupported status`)
}

function assertPassCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function validateExistingProfile(profile) {
  assertExactKeys(profile, [
    'status',
    'portableVerified',
    'identityPreserved',
    'workspacePreserved',
    'lifecyclePreserved',
    'evidencePreserved',
    'reopenPassed',
    'recoveryMode',
    'duplicateProductionCount',
    'duplicateBatchCount',
    'invalidCount',
    'quarantinedCount',
  ], 'profiles.existing')
  assertStatus(profile.status, 'profiles.existing.status')
  for (const field of [
    'portableVerified',
    'identityPreserved',
    'workspacePreserved',
    'lifecyclePreserved',
    'evidencePreserved',
    'reopenPassed',
  ]) assertBoolean(profile[field], `profiles.existing.${field}`)
  if (!recoveryModes.has(profile.recoveryMode)) {
    throw new Error('profiles.existing.recoveryMode is unsupported')
  }
  for (const field of [
    'duplicateProductionCount',
    'duplicateBatchCount',
    'invalidCount',
    'quarantinedCount',
  ]) assertCount(profile[field], `profiles.existing.${field}`)

  if (profile.status === 'pass') {
    assertPassCondition(profile.portableVerified, 'existing-profile PASS requires verified portable')
    assertPassCondition(profile.identityPreserved, 'existing-profile PASS requires preserved identity')
    assertPassCondition(profile.workspacePreserved, 'existing-profile PASS requires preserved Workspace')
    assertPassCondition(profile.lifecyclePreserved, 'existing-profile PASS requires preserved lifecycle')
    assertPassCondition(profile.evidencePreserved, 'existing-profile PASS requires preserved evidence state')
    assertPassCondition(profile.reopenPassed, 'existing-profile PASS requires reopen success')
    assertPassCondition(
      profile.recoveryMode === 'not-required' || profile.recoveryMode === 'explicit-only',
      'existing-profile PASS requires safe recovery mode',
    )
    assertPassCondition(profile.duplicateProductionCount === 0, 'existing-profile PASS forbids duplicate production')
    assertPassCondition(profile.duplicateBatchCount === 0, 'existing-profile PASS forbids duplicate batches')
    assertPassCondition(profile.invalidCount === 0, 'existing-profile PASS requires zero invalid records')
    assertPassCondition(profile.quarantinedCount === 0, 'existing-profile PASS requires zero quarantined records')
  }

  if (profile.status === 'not-run') {
    assertPassCondition(!profile.portableVerified, 'existing-profile not-run forbids portable evidence')
    assertPassCondition(!profile.identityPreserved, 'existing-profile not-run forbids identity evidence')
    assertPassCondition(!profile.workspacePreserved, 'existing-profile not-run forbids Workspace evidence')
    assertPassCondition(!profile.lifecyclePreserved, 'existing-profile not-run forbids lifecycle evidence')
    assertPassCondition(!profile.evidencePreserved, 'existing-profile not-run forbids evidence-state claims')
    assertPassCondition(!profile.reopenPassed, 'existing-profile not-run forbids reopen evidence')
    assertPassCondition(profile.recoveryMode === 'not-run', 'existing-profile not-run requires not-run recovery')
    assertPassCondition(profile.duplicateProductionCount === 0, 'existing-profile not-run requires zero duplicate production')
    assertPassCondition(profile.duplicateBatchCount === 0, 'existing-profile not-run requires zero duplicate batches')
    assertPassCondition(profile.invalidCount === 0, 'existing-profile not-run requires zero invalid records')
    assertPassCondition(profile.quarantinedCount === 0, 'existing-profile not-run requires zero quarantined records')
  }
}

function validateCleanProfile(profile, candidateVersion) {
  assertExactKeys(profile, [
    'status',
    'registrationCount',
    'shortcutCount',
    'cliVersion',
    'firstLaunchPassed',
    'uninstallPassed',
    'sentinelPreserved',
  ], 'profiles.clean')
  assertStatus(profile.status, 'profiles.clean.status')
  assertCount(profile.registrationCount, 'profiles.clean.registrationCount', 10)
  assertCount(profile.shortcutCount, 'profiles.clean.shortcutCount', 10)
  if (profile.cliVersion !== null && (typeof profile.cliVersion !== 'string' || !semverPattern.test(profile.cliVersion))) {
    throw new Error('profiles.clean.cliVersion must be null or semantic version')
  }
  for (const field of ['firstLaunchPassed', 'uninstallPassed', 'sentinelPreserved']) {
    assertBoolean(profile[field], `profiles.clean.${field}`)
  }
  if (profile.status === 'pass') {
    assertPassCondition(profile.registrationCount === 1, 'clean-profile PASS requires one registration')
    assertPassCondition(profile.shortcutCount === 1, 'clean-profile PASS requires one shortcut')
    assertPassCondition(profile.cliVersion === candidateVersion, 'clean-profile PASS requires current CLI version')
    assertPassCondition(profile.firstLaunchPassed, 'clean-profile PASS requires first launch')
    assertPassCondition(profile.uninstallPassed, 'clean-profile PASS requires uninstall')
    assertPassCondition(profile.sentinelPreserved, 'clean-profile PASS requires preserved sentinel')
  }

  if (profile.status === 'not-run') {
    assertPassCondition(profile.registrationCount === 0, 'clean-profile not-run requires zero registrations')
    assertPassCondition(profile.shortcutCount === 0, 'clean-profile not-run requires zero shortcuts')
    assertPassCondition(profile.cliVersion === null, 'clean-profile not-run forbids a CLI version claim')
    assertPassCondition(!profile.firstLaunchPassed, 'clean-profile not-run forbids launch evidence')
    assertPassCondition(!profile.uninstallPassed, 'clean-profile not-run forbids uninstall evidence')
    assertPassCondition(!profile.sentinelPreserved, 'clean-profile not-run forbids sentinel evidence')
  }
}

function validateMigrationProfile(profile) {
  assertExactKeys(profile, [
    'status',
    'transitions',
    'sentinelPreserved',
    'fixtureRemoved',
  ], 'profiles.migration')
  assertStatus(profile.status, 'profiles.migration.status')
  if (!Array.isArray(profile.transitions) || profile.transitions.some(value => typeof value !== 'string')) {
    throw new Error('profiles.migration.transitions must be a string array')
  }
  assertBoolean(profile.sentinelPreserved, 'profiles.migration.sentinelPreserved')
  assertBoolean(profile.fixtureRemoved, 'profiles.migration.fixtureRemoved')
  if (profile.status === 'pass') {
    assertPassCondition(
      JSON.stringify(profile.transitions) === JSON.stringify(EXPECTED_MIGRATION_TRANSITIONS),
      'migration-profile PASS requires the complete declared transition sequence',
    )
    assertPassCondition(profile.sentinelPreserved, 'migration-profile PASS requires preserved sentinel')
    assertPassCondition(profile.fixtureRemoved, 'migration-profile PASS requires fixture removal')
  }

  if (profile.status === 'not-run') {
    assertPassCondition(profile.transitions.length === 0, 'migration-profile not-run forbids transitions')
    assertPassCondition(!profile.sentinelPreserved, 'migration-profile not-run forbids sentinel evidence')
    assertPassCondition(!profile.fixtureRemoved, 'migration-profile not-run forbids fixture evidence')
  }
}

export function validateWindowsPhysicalAcceptanceReport(report, options = {}) {
  assertExactKeys(report, [
    'kind',
    'version',
    'generatedAt',
    'source',
    'candidate',
    'platform',
    'profiles',
    'privacy',
    'limitations',
  ], 'report')
  if (report.kind !== 'metrora.windows-physical-acceptance-report' || report.version !== 1) {
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
    throw new Error('physical acceptance requires Windows x64')
  }

  assertExactKeys(report.profiles, ['existing', 'clean', 'migration'], 'profiles')
  validateExistingProfile(report.profiles.existing)
  validateCleanProfile(report.profiles.clean, report.candidate.productVersion)
  validateMigrationProfile(report.profiles.migration)

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
  for (const required of ['unsigned-candidate', 'no-official-release', 'no-update-channel']) {
    if (!unique.has(required)) throw new Error(`limitations must include ${required}`)
  }

  return report
}
