import { readFileSync } from 'node:fs'

import { buildVersionFor, parseMetroraVersion } from './version-authority-lib.mjs'

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function fail(message) { throw new Error(`version authority: ${message}`) }
function requireText(path, expected, label) {
  const content = readFileSync(path, 'utf8')
  if (!content.includes(expected)) fail(`${label} is stale in ${path}`)
}

const rootPackage = readJson('package.json')
const rootLock = readJson('package-lock.json')
const appPackage = readJson('app/package.json')
const appLock = readJson('app/package-lock.json')
const version = rootPackage.version

parseMetroraVersion(version)
const expectedBuildVersion = buildVersionFor(version)

if (appPackage.version !== version) fail(`app/package.json is ${appPackage.version}, expected ${version}`)
if (rootLock.version !== version || rootLock.packages?.['']?.version !== version) fail('root package-lock version is inconsistent')
if (appLock.version !== version || appLock.packages?.['']?.version !== version) fail('desktop package-lock version is inconsistent')
if (appPackage.build?.buildVersion !== expectedBuildVersion) {
  fail(`desktop buildVersion is ${appPackage.build?.buildVersion}, expected ${expectedBuildVersion}`)
}

requireText('RELEASING.md', `- Current source candidate: \`${version}\``, 'source candidate')
requireText('RELEASING.md', `- Current desktop build version: \`${expectedBuildVersion}\``, 'desktop build version')
requireText('app/DISTRIBUTION.md', `- Current source/desktop candidate: \`${version}\``, 'desktop source candidate')
requireText('app/DISTRIBUTION.md', `- Current desktop build version: \`${expectedBuildVersion}\``, 'desktop build version')
requireText('docs/VERSIONING.md', `- Current source candidate: \`${version}\``, 'public source candidate')
requireText('docs/VERSIONING.md', `- Desktop build version: \`${expectedBuildVersion}\``, 'desktop build version')
requireText(
  'docs/WINDOWS_DISTRIBUTION.md',
  `The active source line associated with the Store submission is \`${version}\`, with desktop build version \`${expectedBuildVersion}\`.`,
  'Windows distribution version',
)

console.log(`Version authority verified: ${version} (${expectedBuildVersion})`)
