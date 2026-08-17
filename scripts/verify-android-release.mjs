#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export const ANDROID_RELEASE_MANIFEST_VERSION = 1
export const ANDROID_APPLICATION_ID = 'eu.metrora.app'
export const ANDROID_DISTRIBUTION_CHANNEL = 'github'

const sha256Pattern = /^[a-f0-9]{64}$/
const gitSha1Pattern = /^[a-f0-9]{40}$/
const versionNamePattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  const contents = await readFile(path)
  hash.update(contents)
  return hash.digest('hex')
}

export function normalizeCertificateFingerprint(value) {
  const normalized = String(value).replaceAll(/[:\s-]/g, '').toLowerCase()
  if (!sha256Pattern.test(normalized)) {
    throw new Error('signing certificate SHA-256 must be exactly 64 lowercase hexadecimal characters')
  }
  return normalized
}

export function artifactFilenameForVersion(versionName) {
  if (!versionNamePattern.test(versionName)) {
    throw new Error(`Android versionName is not a supported release identifier: ${versionName}`)
  }
  return `Metrora-Android-${versionName}.apk`
}

export function manifestFilenameForArtifact(artifactFilename) {
  if (!artifactFilename.endsWith('.apk')) {
    throw new Error('Android release artifact must be an APK')
  }
  return artifactFilename.slice(0, -'.apk'.length) + '.manifest.json'
}

export function parseAaptBadging(output) {
  const packageLine = String(output).split(/\r?\n/).find(line => line.startsWith('package:'))
  if (!packageLine) throw new Error('aapt2 did not report an Android package')

  const packageName = packageLine.match(/\bname='([^']+)'/)?.[1]
  const versionCodeText = packageLine.match(/\bversionCode='([^']+)'/)?.[1]
  const versionName = packageLine.match(/\bversionName='([^']+)'/)?.[1]
  const versionCode = Number(versionCodeText)

  if (!packageName || !versionName || !Number.isSafeInteger(versionCode) || versionCode < 1) {
    throw new Error('aapt2 package metadata is incomplete or invalid')
  }

  return { applicationId: packageName, versionName, versionCode }
}

export function parseApksignerOutput(output) {
  if (!/\bVerified\b/i.test(output)) {
    throw new Error('apksigner did not verify the APK')
  }

  const matches = [...String(output).matchAll(/certificate SHA-256 digest:\s*([0-9a-f: -]+)/ig)]
  if (matches.length !== 1) {
    throw new Error('APK must have exactly one verifiable signing certificate')
  }

  return normalizeCertificateFingerprint(matches[0][1])
}

export function parseSha256Sums(text) {
  if (!String(text).endsWith('\n')) throw new Error('SHA256SUMS must end with a newline')

  const result = new Map()
  const lines = String(text).trimEnd().split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  ([^\r\n]+)$/)
    if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`)
    const filename = match[2]
    if (
      !filename
      || filename.includes('/')
      || filename.includes('\\')
      || filename === '.'
      || filename === '..'
      || filename.includes('..')
    ) {
      throw new Error(`invalid SHA256SUMS filename: ${filename}`)
    }
    if (result.has(filename)) throw new Error(`duplicate SHA256SUMS filename: ${filename}`)
    result.set(filename, match[1])
  }
  return result
}

export function buildReleaseManifest({
  applicationId,
  versionName,
  versionCode,
  sourceCommit,
  artifactFilename,
  artifactSha256,
  signingCertificateSha256,
}) {
  if (applicationId !== ANDROID_APPLICATION_ID) throw new Error('unexpected Android applicationId')
  if (versionName === undefined || !versionNamePattern.test(versionName)) {
    throw new Error('Android versionName is invalid')
  }
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error('Android versionCode is invalid')
  if (!gitSha1Pattern.test(sourceCommit)) throw new Error('source commit must be a lowercase 40-character SHA-1')
  if (artifactFilename !== artifactFilenameForVersion(versionName)) {
    throw new Error('Android artifact filename is not canonical for versionName')
  }
  if (!sha256Pattern.test(artifactSha256)) throw new Error('Android artifact SHA-256 is invalid')
  const certificate = normalizeCertificateFingerprint(signingCertificateSha256)

  return {
    schemaVersion: ANDROID_RELEASE_MANIFEST_VERSION,
    product: 'Metrora',
    versionName,
    versionCode,
    distributionChannel: ANDROID_DISTRIBUTION_CHANNEL,
    applicationId,
    sourceCommit,
    artifactFilename,
    artifactSha256,
    signingCertificateSha256: certificate,
  }
}

export function validateReleaseManifest(manifest, expected = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Android release manifest must be an object')
  if (manifest.schemaVersion !== ANDROID_RELEASE_MANIFEST_VERSION) throw new Error('unsupported Android release manifest schema')
  if (manifest.product !== 'Metrora') throw new Error('Android release manifest product is not canonical')
  if (manifest.distributionChannel !== ANDROID_DISTRIBUTION_CHANNEL) {
    throw new Error('Android release manifest distribution channel is not github')
  }
  if (manifest.applicationId !== ANDROID_APPLICATION_ID) throw new Error('Android release manifest applicationId is invalid')
  if (!versionNamePattern.test(manifest.versionName)) throw new Error('Android release manifest versionName is invalid')
  if (!Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1) {
    throw new Error('Android release manifest versionCode is invalid')
  }
  if (!gitSha1Pattern.test(manifest.sourceCommit)) throw new Error('Android release manifest source commit is invalid')
  if (manifest.artifactFilename !== artifactFilenameForVersion(manifest.versionName)) {
    throw new Error('Android release manifest artifact filename is not canonical')
  }
  if (!sha256Pattern.test(manifest.artifactSha256)) throw new Error('Android release manifest artifact SHA-256 is invalid')
  normalizeCertificateFingerprint(manifest.signingCertificateSha256)

  if (expected.sourceCommit && manifest.sourceCommit !== expected.sourceCommit) {
    throw new Error('Android release source commit does not match the expected commit')
  }
  if (expected.applicationId && manifest.applicationId !== expected.applicationId) {
    throw new Error('Android release applicationId does not match the expected applicationId')
  }
  if (expected.versionName && manifest.versionName !== expected.versionName) {
    throw new Error('Android release versionName does not match the expected versionName')
  }
  if (expected.versionCode !== undefined && manifest.versionCode !== expected.versionCode) {
    throw new Error('Android release versionCode does not match the expected versionCode')
  }
  if (expected.signingCertificateSha256) {
    const expectedCertificate = normalizeCertificateFingerprint(expected.signingCertificateSha256)
    if (manifest.signingCertificateSha256 !== expectedCertificate) {
      throw new Error('Android release signing certificate does not match the expected certificate')
    }
  }
  return manifest
}

export function assertApkMetadataMatches(metadata, expected) {
  if (metadata.applicationId !== expected.applicationId) throw new Error('APK applicationId does not match the expected applicationId')
  if (metadata.versionName !== expected.versionName) throw new Error('APK versionName does not match the expected versionName')
  if (metadata.versionCode !== expected.versionCode) throw new Error('APK versionCode does not match the expected versionCode')
  const expectedCertificate = normalizeCertificateFingerprint(expected.signingCertificateSha256)
  if (metadata.signingCertificateSha256 !== expectedCertificate) {
    throw new Error('APK signing certificate does not match the expected certificate')
  }
}

function runTool(command, argumentsList) {
  try {
    return execFileSync(command, argumentsList, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stderr = String(error?.stderr ?? '').trim().split(/\r?\n/).at(-1)
    throw new Error(`${basename(command)} failed${stderr ? `: ${stderr}` : ''}`)
  }
}

export async function inspectApk(apkPath, { aapt2, apksigner }) {
  const apk = resolve(apkPath)
  const info = await stat(apk).catch(() => null)
  if (!info?.isFile()) throw new Error(`APK does not exist: ${apk}`)
  if (!aapt2 || !apksigner) throw new Error('aapt2 and apksigner paths are required for APK verification')

  const packageInfo = parseAaptBadging(runTool(aapt2, ['dump', 'badging', apk]))
  const signingCertificateSha256 = parseApksignerOutput(
    runTool(apksigner, ['verify', '--verbose', '--print-certs', apk]),
  )
  return { ...packageInfo, signingCertificateSha256 }
}

async function assertDirectoryContainsOnly(root, expectedNames) {
  const entries = await readdir(root, { withFileTypes: true })
  const actualNames = entries.map(entry => entry.name).sort(compareText)
  const expected = [...expectedNames].sort(compareText)
  if (JSON.stringify(actualNames) !== JSON.stringify(expected)) {
    throw new Error(`Android release bundle files are not canonical: expected ${expected.join(', ')}`)
  }
  if (entries.some(entry => !entry.isFile())) throw new Error('Android release bundle cannot contain directories')
}

export async function verifyReleaseBundle(bundleDirectory, options = {}) {
  const root = resolve(bundleDirectory)
  const entries = await readdir(root, { withFileTypes: true })
  const manifestCandidates = entries
    .filter(entry => entry.isFile() && /^Metrora-Android-.+\.manifest\.json$/.test(entry.name))
    .map(entry => entry.name)
  if (manifestCandidates.length !== 1) throw new Error('Android release bundle must contain exactly one release manifest')

  const manifestFilename = manifestCandidates[0]
  const manifest = JSON.parse(await readFile(join(root, manifestFilename), 'utf8'))
  validateReleaseManifest(manifest, options)
  const expectedManifestFilename = manifestFilenameForArtifact(manifest.artifactFilename)
  if (manifestFilename !== expectedManifestFilename) throw new Error('Android release manifest filename is not canonical')

  const checksumsFilename = 'SHA256SUMS'
  await assertDirectoryContainsOnly(root, [manifest.artifactFilename, manifestFilename, checksumsFilename])
  const sums = parseSha256Sums(await readFile(join(root, checksumsFilename), 'utf8'))
  const expectedNames = [manifest.artifactFilename, manifestFilename].sort(compareText)
  if (JSON.stringify([...sums.keys()].sort(compareText)) !== JSON.stringify(expectedNames)) {
    throw new Error('SHA256SUMS must contain exactly the APK and manifest')
  }

  const artifactPath = join(root, manifest.artifactFilename)
  const manifestPath = join(root, manifestFilename)
  const artifactSha256 = await sha256File(artifactPath)
  const manifestSha256 = await sha256File(manifestPath)
  if (artifactSha256 !== manifest.artifactSha256 || sums.get(manifest.artifactFilename) !== artifactSha256) {
    throw new Error('Android APK checksum mismatch')
  }
  if (sums.get(manifestFilename) !== manifestSha256) throw new Error('Android release manifest checksum mismatch')

  const apkMetadata = await inspectApk(artifactPath, options)
  assertApkMetadataMatches(apkMetadata, {
    applicationId: manifest.applicationId,
    versionName: manifest.versionName,
    versionCode: manifest.versionCode,
    signingCertificateSha256: manifest.signingCertificateSha256,
  })
  if (options.signingCertificateSha256) {
    const expectedCertificate = normalizeCertificateFingerprint(options.signingCertificateSha256)
    if (apkMetadata.signingCertificateSha256 !== expectedCertificate) {
      throw new Error('APK signing certificate does not match the configured production certificate')
    }
  }

  return { manifest, apkMetadata, artifactSha256, manifestSha256 }
}

export async function createReleaseBundle({
  apkPath,
  outputDirectory,
  sourceCommit,
  expectedApplicationId = ANDROID_APPLICATION_ID,
  expectedVersionName,
  expectedVersionCode,
  signingCertificateSha256,
  aapt2,
  apksigner,
}) {
  if (expectedApplicationId !== ANDROID_APPLICATION_ID) throw new Error('unexpected Android applicationId authority')
  const expectedCertificate = normalizeCertificateFingerprint(signingCertificateSha256)
  const apkMetadata = await inspectApk(apkPath, { aapt2, apksigner })
  if (apkMetadata.applicationId !== expectedApplicationId) throw new Error('APK applicationId is not the public applicationId')
  if (expectedVersionName !== undefined && apkMetadata.versionName !== expectedVersionName) {
    throw new Error('APK versionName does not match the source version authority')
  }
  if (expectedVersionCode !== undefined && apkMetadata.versionCode !== expectedVersionCode) {
    throw new Error('APK versionCode does not match the source version authority')
  }
  if (apkMetadata.signingCertificateSha256 !== expectedCertificate) {
    throw new Error('APK is not signed by the configured production certificate')
  }

  const artifactFilename = artifactFilenameForVersion(apkMetadata.versionName)
  const manifestFilename = manifestFilenameForArtifact(artifactFilename)
  const root = resolve(outputDirectory)
  await mkdir(root, { recursive: true })
  const existingEntries = await readdir(root)
  if (existingEntries.length > 0) throw new Error('Android release output directory must be empty')

  const artifactPath = join(root, artifactFilename)
  await copyFile(resolve(apkPath), artifactPath)
  const artifactSha256 = await sha256File(artifactPath)
  const manifest = buildReleaseManifest({
    applicationId: apkMetadata.applicationId,
    versionName: apkMetadata.versionName,
    versionCode: apkMetadata.versionCode,
    sourceCommit,
    artifactFilename,
    artifactSha256,
    signingCertificateSha256: expectedCertificate,
  })
  const manifestPath = join(root, manifestFilename)
  await writeFile(manifestPath, stableJson(manifest), 'utf8')
  const manifestSha256 = await sha256File(manifestPath)
  await writeFile(
    join(root, 'SHA256SUMS'),
    `${artifactSha256}  ${artifactFilename}\n${manifestSha256}  ${manifestFilename}\n`,
    'ascii',
  )

  return verifyReleaseBundle(root, {
    sourceCommit,
    applicationId: expectedApplicationId,
    versionName: expectedVersionName,
    versionCode: expectedVersionCode,
    signingCertificateSha256: expectedCertificate,
    aapt2,
    apksigner,
  })
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('expected --name value arguments')
    }
    if (values.has(key)) throw new Error(`duplicate argument: ${key}`)
    values.set(key, value)
  }
  return values
}

function required(values, name) {
  const value = values.get(name)
  if (!value) throw new Error(`missing required argument: ${name}`)
  return value
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const aapt2 = required(args, '--aapt2')
  const apksigner = required(args, '--apksigner')

  if (args.has('--apk')) {
    if (args.has('--bundle')) throw new Error('use either --apk or --bundle, not both')
    const result = await createReleaseBundle({
      apkPath: required(args, '--apk'),
      outputDirectory: required(args, '--output-dir'),
      sourceCommit: required(args, '--source-commit'),
      expectedApplicationId: args.get('--expected-application-id') ?? ANDROID_APPLICATION_ID,
      expectedVersionName: args.get('--expected-version-name'),
      expectedVersionCode: args.has('--expected-version-code') ? Number(required(args, '--expected-version-code')) : undefined,
      signingCertificateSha256: required(args, '--expected-certificate-sha256'),
      aapt2,
      apksigner,
    })
    process.stdout.write(`Verified Metrora Android ${result.manifest.versionName} (${result.manifest.versionCode}) from ${result.manifest.sourceCommit}\n`)
    process.stdout.write(`Artifact: ${result.manifest.artifactFilename}\nSHA-256: ${result.manifest.artifactSha256}\n`)
    return
  }

  if (args.has('--bundle')) {
    const result = await verifyReleaseBundle(resolve(required(args, '--bundle')), {
      sourceCommit: args.get('--expected-source-commit'),
      applicationId: args.get('--expected-application-id') ?? ANDROID_APPLICATION_ID,
      versionName: args.get('--expected-version-name'),
      versionCode: args.has('--expected-version-code') ? Number(required(args, '--expected-version-code')) : undefined,
      signingCertificateSha256: required(args, '--expected-certificate-sha256'),
      aapt2,
      apksigner,
    })
    process.stdout.write(`Verified Metrora Android ${result.manifest.versionName} (${result.manifest.versionCode}) from ${result.manifest.sourceCommit}\n`)
    process.stdout.write(`Artifact: ${result.manifest.artifactFilename}\nSHA-256: ${result.manifest.artifactSha256}\n`)
    return
  }

  throw new Error('usage: verify-android-release.mjs --apk <apk> --output-dir <dir> ... or --bundle <dir> ...')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`Android release verification failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
