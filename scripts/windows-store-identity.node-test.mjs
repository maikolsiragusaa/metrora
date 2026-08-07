#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
const desktopPackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'app/package.json'), 'utf8'))
const brandGenerator = readFileSync(resolve(repositoryRoot, 'scripts/generate-brand-assets.mjs'), 'utf8')

const expected = Object.freeze({
  applicationId: 'eu.metrora.desktop',
  identityName: 'Vensent.Metrora',
  publisher: 'CN=BC955F81-5099-4C27-A7A6-FF611BAACC3F',
  publisherDisplayName: 'Vensent',
  displayName: 'Metrora',
  artifactName: 'Metrora-${version}-Windows-Store-${arch}.${ext}',
})

assert.equal(
  desktopPackage.scripts?.['package:store'],
  'npm run stage-cli && npm run build && electron-builder --win appx --x64 --publish never',
  'the Store build must remain an explicit non-publishing x64 AppX target',
)

assert.equal(
  desktopPackage.scripts?.['package:win'],
  'npm run stage-cli && npm run build && electron-builder --win',
  'the existing Windows packaging command must remain unchanged',
)

assert.deepEqual(
  desktopPackage.build?.win?.target,
  [{ target: 'nsis', arch: ['x64'] }],
  'the GitHub/technical-user Windows channel must remain the NSIS x64 target',
)

assert.equal(
  desktopPackage.build?.nsis?.artifactName,
  'Metrora-Setup-${version}.${ext}',
  'the accepted NSIS artifact name must remain unchanged',
)

const appx = desktopPackage.build?.appx
assert.ok(appx && typeof appx === 'object', 'an AppX configuration is required')

for (const [field, value] of Object.entries(expected)) {
  assert.equal(appx[field], value, `AppX ${field} must match the reviewed Store authority`)
}

assert.deepEqual(
  appx.capabilities,
  ['runFullTrust'],
  'the Store package must declare only the currently required full-trust capability',
)

assert.equal(
  Object.hasOwn(appx, 'publish'),
  false,
  'the build configuration must not submit or publish to Partner Center',
)

assert.equal(
  Object.hasOwn(desktopPackage.build, 'publish'),
  false,
  'the desktop build must not gain an implicit publication target',
)

assert.equal(desktopPackage.version, rootPackage.version, 'desktop and root product SemVer must match')
assert.equal(
  desktopPackage.build?.buildVersion,
  '1.0.0.8',
  'the current desktop build version authority must remain 1.0.0.8',
)

const productCore = rootPackage.version.replace(/-rc\.\d+$/, '')
assert.match(productCore, /^\d+\.\d+\.\d+$/)
assert.equal(
  `${productCore}.0`,
  '1.0.0.0',
  'the current Microsoft Store AppX identity version mapping must remain 1.0.0.0',
)

for (const asset of [
  'app/build/appx/StoreLogo.png',
  'app/build/appx/Square44x44Logo.png',
  'app/build/appx/Square150x150Logo.png',
  'app/build/appx/Wide310x150Logo.png',
]) {
  assert.ok(brandGenerator.includes(asset), `the deterministic brand generator must emit ${asset}`)
}

console.log('Windows Store identity, version authorities, assets and channel separation are valid.')
