import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readRepositoryFile = relativePath =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

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

test('release scanner uses ZXing core and keeps camera-independent image import', () => {
  const versionCatalog = readRepositoryFile('android/gradle/libs.versions.toml')
  const buildGradle = readRepositoryFile('android/app/build.gradle.kts')
  const proguardRules = readRepositoryFile('android/app/proguard-rules.pro')
  const scannerSource = readRepositoryFile(
    'android/app/src/main/kotlin/eu/metrora/app/ui/QrScanner.kt',
  )
  const imageDecoderSource = readRepositoryFile(
    'android/app/src/main/kotlin/eu/metrora/app/ui/QrImageDecoder.kt',
  )
  const zxingDecoderSource = readRepositoryFile(
    'android/app/src/main/kotlin/eu/metrora/app/ui/QrCodeDecoder.kt',
  )

  assert.match(versionCatalog, /zxing = "3\.5\.4"/)
  assert.match(versionCatalog, /com\.google\.zxing:core/)
  assert.match(buildGradle, /implementation\(libs\.zxing\.core\)/)
  assert.match(zxingDecoderSource, /QRCodeReader/)
  assert.match(zxingDecoderSource, /QRCodeMultiReader/)

  for (const source of [versionCatalog, buildGradle, proguardRules, scannerSource, imageDecoderSource]) {
    assert.doesNotMatch(source, /com\.google\.mlkit/)
  }
  assert.doesNotMatch(versionCatalog, /mlkitBarcode|mlkit-barcode/)
  assert.doesNotMatch(imageDecoderSource, /com\.google\.android\.gms\.tasks/)

  const cameraBranch = scannerSource.indexOf('if (hasPermission)')
  const cameraBranchEnd = scannerSource.indexOf('\n        OutlinedButton(', cameraBranch)
  const imageImport = scannerSource.indexOf('R.string.import_qr_from_image')

  assert.notEqual(cameraBranch, -1)
  assert.notEqual(cameraBranchEnd, -1)
  assert.notEqual(imageImport, -1)
  assert.ok(imageImport > cameraBranchEnd)
  assert.match(scannerSource.slice(cameraBranch, cameraBranchEnd), /CameraPermissionPrompt/)
})
