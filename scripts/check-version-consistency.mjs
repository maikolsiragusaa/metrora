import { readFileSync } from 'node:fs'

import {
  STORE_PACKAGE_VERSION_AUTHORITY_PATH,
  buildVersionFor,
  parseMetroraVersion,
  validateStorePackageVersionAuthority,
} from './version-authority-lib.mjs'

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function fail(message) { throw new Error(`version authority: ${message}`) }

const rootPackage = readJson('package.json')
const rootLock = readJson('package-lock.json')
const appPackage = readJson('app/package.json')
const appLock = readJson('app/package-lock.json')
const storePackageVersionAuthority = validateStorePackageVersionAuthority(readJson(STORE_PACKAGE_VERSION_AUTHORITY_PATH))
const version = rootPackage.version

parseMetroraVersion(version)
const expectedBuildVersion = buildVersionFor(version)

if (appPackage.version !== version) fail(`app/package.json is ${appPackage.version}, expected ${version}`)
if (rootLock.version !== version || rootLock.packages?.['']?.version !== version) fail('root package-lock version is inconsistent')
if (appLock.version !== version || appLock.packages?.['']?.version !== version) fail('desktop package-lock version is inconsistent')
if (appPackage.build?.buildVersion !== expectedBuildVersion) {
  fail(`desktop buildVersion is ${appPackage.build?.buildVersion}, expected ${expectedBuildVersion}`)
}

console.log(
  `Version authority verified: ${version} (${expectedBuildVersion}); ` +
  `Store package ${storePackageVersionAuthority.publishedStorePackageVersion} -> ${storePackageVersionAuthority.candidateStorePackageVersion}`,
)
