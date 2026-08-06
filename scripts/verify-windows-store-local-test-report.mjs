#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.join('\0') !== wanted.join('\0')) {
    fail(`${label} fields are invalid`)
  }
}

function requireString(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail(`${label} is invalid`)
  }
}

const args = process.argv.slice(2)
const reportArg = args.shift()
if (!reportArg) fail('Usage: verify-windows-store-local-test-report.mjs <report> --expected-commit <sha> [--require-pass]')

let expectedCommit = null
let requirePass = false
while (args.length > 0) {
  const argument = args.shift()
  if (argument === '--expected-commit') {
    expectedCommit = args.shift() ?? null
  } else if (argument === '--require-pass') {
    requirePass = true
  } else {
    fail(`Unknown argument: ${argument}`)
  }
}

requireString(expectedCommit, /^[a-f0-9]{40}$/, 'expected commit')

let report
try {
  report = JSON.parse(readFileSync(resolve(reportArg), 'utf8'))
} catch (error) {
  fail(`Report could not be read: ${error instanceof Error ? error.message : String(error)}`)
}

exactKeys(report, [
  'kind',
  'version',
  'status',
  'generatedAt',
  'source',
  'package',
  'platform',
  'observations',
  'cleanup',
  'privacy',
  'limitations',
], 'report')

if (report.kind !== 'metrora.windows-store-local-test-report' || report.version !== 1) {
  fail('report identity is invalid')
}
if (!['pass', 'fail'].includes(report.status)) fail('report status is invalid')
requireString(report.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'generatedAt')

exactKeys(report.source, ['repository', 'commit'], 'source')
if (report.source.repository !== 'maikolsiragusaa/metrora' || report.source.commit !== expectedCommit) {
  fail('source authority is invalid')
}

exactKeys(report.package, [
  'artifactName',
  'unsignedSha256',
  'testSignedSha256',
  'version',
  'architecture',
], 'package')
requireString(report.package.artifactName, /^[A-Za-z0-9][A-Za-z0-9._-]*\.appx$/, 'package artifactName')
requireString(report.package.unsignedSha256, /^[a-f0-9]{64}$/, 'package unsignedSha256')
requireString(report.package.testSignedSha256, /^[a-f0-9]{64}$/, 'package testSignedSha256')
if (report.package.unsignedSha256 === report.package.testSignedSha256) {
  fail('test-signed package must differ from the unsigned candidate')
}
requireString(report.package.version, /^\d+\.\d+\.\d+\.\d+$/, 'package version')
if (report.package.architecture !== 'x64') fail('package architecture is invalid')

exactKeys(report.platform, ['edition', 'version', 'build', 'architecture'], 'platform')
for (const field of ['edition', 'version', 'build']) {
  requireString(report.platform[field], /^.{1,120}$/, `platform.${field}`)
}
if (report.platform.architecture !== 'x64') fail('platform architecture is invalid')

exactKeys(report.observations, [
  'launch',
  'identityPresentation',
  'localCollection',
  'noExternalNode',
], 'observations')
for (const [field, value] of Object.entries(report.observations)) {
  if (!['pass', 'fail'].includes(value)) fail(`observations.${field} is invalid`)
}

exactKeys(report.cleanup, ['packageRemoved', 'certificateRemoved', 'privateKeyRemoved'], 'cleanup')
for (const [field, value] of Object.entries(report.cleanup)) {
  if (typeof value !== 'boolean') fail(`cleanup.${field} must be boolean`)
}

exactKeys(report.privacy, [
  'containsPrivatePaths',
  'containsUsernames',
  'containsPromptsOrResponses',
  'containsPackageIdentityValues',
  'containsKeysOrCertificates',
], 'privacy')
for (const [field, value] of Object.entries(report.privacy)) {
  if (value !== false) fail(`privacy.${field} must be false`)
}

const requiredLimitations = [
  'local-test-signature',
  'not-store-signed',
  'not-submitted',
  'not-published',
  'single-windows-host',
  'no-update-flight',
]
if (!Array.isArray(report.limitations) || report.limitations.join('\0') !== requiredLimitations.join('\0')) {
  fail('limitations are invalid')
}

const observationsPass = Object.values(report.observations).every((value) => value === 'pass')
const cleanupPass = Object.values(report.cleanup).every((value) => value === true)
const expectedStatus = observationsPass && cleanupPass ? 'pass' : 'fail'
if (report.status !== expectedStatus) fail('report status contradicts observations or cleanup')
if (requirePass && report.status !== 'pass') fail('a passing Store local-test report is required')

console.log(JSON.stringify({
  status: report.status,
  sourceCommit: report.source.commit,
  packageVersion: report.package.version,
  architecture: report.package.architecture,
}))
