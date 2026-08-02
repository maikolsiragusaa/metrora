#!/usr/bin/env node

import process from 'node:process'
import { resolve } from 'node:path'

import { verifyWindowsCandidateLayout } from './windows-release-layout.mjs'

function parse(argv) {
  const result = { candidate: undefined, expectedCommit: undefined, repositoryRoot: process.cwd() }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
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
    if (result.candidate) throw new Error('only one Windows candidate directory may be verified')
    result.candidate = value
  }
  if (!result.candidate) {
    throw new Error('usage: verify-windows-candidate-layout.mjs <candidate> [--expected-commit <sha>]')
  }
  return result
}

const args = parse(process.argv.slice(2))
const result = await verifyWindowsCandidateLayout({
  repositoryRoot: resolve(args.repositoryRoot),
  candidateDirectory: resolve(args.candidate),
  ...(args.expectedCommit ? { expectedCommit: args.expectedCommit } : {}),
})

process.stdout.write(`Verified Metrora ${result.productVersion} Windows formats from ${result.sourceCommit}: ${result.canonicalFileCount} canonical files, installer ${result.installerFiles.join(', ')}, derivation ${result.formatManifestSha256}\n`)
