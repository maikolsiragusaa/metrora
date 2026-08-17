import test from 'node:test'
import assert from 'node:assert/strict'

import {
  artifactFilenameForVersion,
  assertApkMetadataMatches,
  buildReleaseManifest,
  normalizeCertificateFingerprint,
  parseAaptBadging,
  parseApksignerOutput,
  parseSha256Sums,
  validateReleaseManifest,
} from './verify-android-release.mjs'

const sourceCommit = 'a'.repeat(40)
const certificate = 'b'.repeat(64)

test('canonical Android artifact naming follows versionName', () => {
  assert.equal(artifactFilenameForVersion('0.1.0-alpha.1'), 'Metrora-Android-0.1.0-alpha.1.apk')
})

test('APK metadata parsers expose package, version and one certificate', () => {
  assert.deepEqual(
    parseAaptBadging("package: name='eu.metrora.app' versionCode='1' versionName='0.1.0-alpha.1'"),
    { applicationId: 'eu.metrora.app', versionCode: 1, versionName: '0.1.0-alpha.1' },
  )
  assert.equal(
    parseApksignerOutput('Verified\nSigner #1 certificate SHA-256 digest: AA:BB:CC:DD' + ':EE:FF'.repeat(14)),
    'aabbccdd' + 'eeff'.repeat(14),
  )
})

test('release manifest validates the public identity and source binding', () => {
  const manifest = buildReleaseManifest({
    applicationId: 'eu.metrora.app',
    versionName: '0.1.0-alpha.1',
    versionCode: 1,
    sourceCommit,
    artifactFilename: 'Metrora-Android-0.1.0-alpha.1.apk',
    artifactSha256: 'c'.repeat(64),
    signingCertificateSha256: certificate,
  })

  assert.doesNotThrow(() => validateReleaseManifest(manifest, {
    sourceCommit,
    applicationId: 'eu.metrora.app',
    versionName: '0.1.0-alpha.1',
    versionCode: 1,
    signingCertificateSha256: certificate,
  }))
  assert.throws(() => validateReleaseManifest({ ...manifest, applicationId: 'eu.metrora.app.debug' }))
  assert.throws(() => validateReleaseManifest({ ...manifest, sourceCommit: 'd'.repeat(40) }, { sourceCommit }))
})

test('APK verification fails closed for a wrong version or certificate', () => {
  const metadata = {
    applicationId: 'eu.metrora.app',
    versionName: '0.1.0-alpha.1',
    versionCode: 1,
    signingCertificateSha256: normalizeCertificateFingerprint(certificate),
  }
  assert.doesNotThrow(() => assertApkMetadataMatches(metadata, {
    applicationId: 'eu.metrora.app',
    versionName: '0.1.0-alpha.1',
    versionCode: 1,
    signingCertificateSha256: certificate,
  }))
  assert.throws(() => assertApkMetadataMatches({ ...metadata, versionCode: 2 }, {
    applicationId: 'eu.metrora.app',
    versionName: '0.1.0-alpha.1',
    versionCode: 1,
    signingCertificateSha256: certificate,
  }))
  assert.throws(() => assertApkMetadataMatches(metadata, {
    applicationId: 'eu.metrora.app',
    versionName: '0.1.0-alpha.1',
    versionCode: 1,
    signingCertificateSha256: 'e'.repeat(64),
  }))
})

test('SHA256SUMS parsing rejects malformed or duplicate entries', () => {
  const apk = 'f'.repeat(64)
  const manifest = '0'.repeat(64)
  assert.deepEqual(
    [...parseSha256Sums(`${apk}  Metrora-Android-0.1.0-alpha.1.apk\n${manifest}  Metrora-Android-0.1.0-alpha.1.manifest.json\n`).entries()],
    [
      ['Metrora-Android-0.1.0-alpha.1.apk', apk],
      ['Metrora-Android-0.1.0-alpha.1.manifest.json', manifest],
    ],
  )
  assert.throws(() => parseSha256Sums(`${apk}  artifact.apk\n${apk}  artifact.apk\n`))
  assert.throws(() => parseSha256Sums(`${apk} *artifact.apk\n`))
})
