#!/usr/bin/env node

import process from 'node:process'
import { resolve } from 'node:path'

import { materializePhysicalCanonicalPayload } from './windows-physical-candidate.mjs'
import { verifyWindowsCandidateLayout } from './windows-release-layout.mjs'

function parse(argv) {
  const result = {
    candidate: undefined,
    output: undefined,
    expectedCommit: undefined,
    repositoryRoot: process.cwd(),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--output') {
      result.output = argv[++index]
      if (!result.output) throw new Error('--output requires a value')
      continue
    }
    if (value === '--expected-commit') {
      result.expectedCommit = argv[++index]
      if (!result.expectedCommit) throw new Error('--expected-commit requires a value')
      continue
    }
    if (value === '--repository-root') {
      result.repositoryRoot = argv[++index]
      if (!result.repositoryRoot) throw new Error('--repository-root requires a value')
      continue
    }
    if (value.startsWith('--')) throw new Error(`unknown argument: ${value}`)
    if (result.candidate) throw new Error('only one Windows candidate directory may be prepared')
    result.candidate = value
  }
  if (!result.candidate || !result.output || !result.expectedCommit) {
    throw new Error('usage: prepare-windows-physical-candidate.mjs <candidate> --output <directory> --expected-commit <sha> [--repository-root <directory>]')
  }
  return result
}

const args = parse(process.argv.slice(2))
const candidateDirectory = resolve(args.candidate)
const repositoryRoot = resolve(args.repositoryRoot)
const verification = await verifyWindowsCandidateLayout({
  repositoryRoot,
  candidateDirectory,
  expectedCommit: args.expectedCommit,
})
const canonical = await materializePhysicalCanonicalPayload({
  candidateDirectory,
  outputDirectory: resolve(args.output),
})

process.stdout.write(`${JSON.stringify({
  status: 'pass',
  sourceCommit: verification.sourceCommit,
  productVersion: verification.productVersion,
  canonicalFileCount: canonical.fileCount,
  canonicalTotalBytes: canonical.totalBytes,
  canonicalInventorySha256: canonical.inventorySha256,
  releaseManifestSha256: (await import('./windows-release-manifest-lib.mjs')).sha256File(
    resolve(candidateDirectory, 'portable', 'RELEASE_MANIFEST.json'),
  ),
  formatManifestSha256: verification.formatManifestSha256,
  installerFiles: verification.installerFiles,
})}\n`)
