#!/usr/bin/env node

import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { join, resolve } from 'node:path'

import {
  ANDROID_APPLICATION_ID,
  ANDROID_PLAY_DISTRIBUTION_CHANNEL,
  aabArtifactFilenameForVersion,
  buildReleaseManifest,
  inspectAab,
  manifestFilenameForArtifact,
  normalizeCertificateFingerprint,
  sha256File,
  stableJson,
  verifyPlayCandidateBundle,
} from './verify-android-release.mjs'

export async function createPlayCandidateBundle({
  aabPath,
  outputDirectory,
  sourceCommit,
  expectedApplicationId = ANDROID_APPLICATION_ID,
  expectedVersionName,
  expectedVersionCode,
  signingCertificateSha256,
  bundletool,
  bundletoolJar,
  jarsigner,
  keytool,
}) {
  if (expectedApplicationId !== ANDROID_APPLICATION_ID) throw new Error('unexpected Android applicationId authority')
  const expectedCertificate = normalizeCertificateFingerprint(signingCertificateSha256)
  const aabMetadata = await inspectAab(aabPath, { bundletool, bundletoolJar, jarsigner, keytool })
  if (aabMetadata.applicationId !== expectedApplicationId) throw new Error('AAB applicationId is not the public applicationId')
  if (expectedVersionName !== undefined && aabMetadata.versionName !== expectedVersionName) {
    throw new Error('AAB versionName does not match the source version authority')
  }
  if (expectedVersionCode !== undefined && aabMetadata.versionCode !== expectedVersionCode) {
    throw new Error('AAB versionCode does not match the source version authority')
  }
  if (aabMetadata.signingCertificateSha256 !== expectedCertificate) {
    throw new Error('AAB is not signed by the configured Play upload certificate')
  }

  const artifactFilename = aabArtifactFilenameForVersion(aabMetadata.versionName)
  const manifestFilename = manifestFilenameForArtifact(artifactFilename)
  const root = resolve(outputDirectory)
  await mkdir(root, { recursive: true })
  const existingEntries = await readdir(root)
  if (existingEntries.length > 0) throw new Error('Android Play candidate output directory must be empty')

  const artifactPath = join(root, artifactFilename)
  await copyFile(resolve(aabPath), artifactPath)
  const artifactSha256 = await sha256File(artifactPath)
  const manifest = buildReleaseManifest({
    applicationId: aabMetadata.applicationId,
    versionName: aabMetadata.versionName,
    versionCode: aabMetadata.versionCode,
    distributionChannel: ANDROID_PLAY_DISTRIBUTION_CHANNEL,
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

  return verifyPlayCandidateBundle(root, {
    sourceCommit,
    applicationId: expectedApplicationId,
    versionName: expectedVersionName,
    versionCode: expectedVersionCode,
    signingCertificateSha256: expectedCertificate,
    bundletool,
    bundletoolJar,
    jarsigner,
    keytool,
  })
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error('expected --name value arguments')
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
  const result = await createPlayCandidateBundle({
    aabPath: required(args, '--aab'),
    outputDirectory: required(args, '--output-dir'),
    sourceCommit: required(args, '--source-commit'),
    expectedApplicationId: args.get('--expected-application-id') ?? ANDROID_APPLICATION_ID,
    expectedVersionName: args.get('--expected-version-name'),
    expectedVersionCode: args.has('--expected-version-code') ? Number(required(args, '--expected-version-code')) : undefined,
    signingCertificateSha256: required(args, '--expected-certificate-sha256'),
    bundletool: required(args, '--bundletool'),
    bundletoolJar: args.get('--bundletool-jar'),
    jarsigner: required(args, '--jarsigner'),
    keytool: required(args, '--keytool'),
  })
  process.stdout.write(`Verified Metrora Play candidate ${result.manifest.versionName} (${result.manifest.versionCode}) from ${result.manifest.sourceCommit}\n`)
  process.stdout.write(`Artifact: ${result.manifest.artifactFilename}\nSHA-256: ${result.manifest.artifactSha256}\n`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`Android Play candidate verification failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
