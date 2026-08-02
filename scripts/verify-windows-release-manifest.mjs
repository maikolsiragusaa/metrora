#!/usr/bin/env node

import process from 'node:process'
import { resolve } from 'node:path'

import { verifyReleaseCandidate } from './windows-release-manifest-lib.mjs'

function parseArguments(argv) {
  const result = { bundle: undefined, expectedCommit: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--expected-commit') {
      result.expectedCommit = argv[++index]
      if (!result.expectedCommit) throw new Error('--expected-commit requires a value')
      continue
    }
    if (value.startsWith('--')) throw new Error(`unknown argument: ${value}`)
    if (result.bundle) throw new Error('only one release candidate directory may be verified')
    result.bundle = value
  }
  if (!result.bundle) throw new Error('usage: verify-windows-release-manifest.mjs <bundle> [--expected-commit <sha>]')
  return result
}

const args = parseArguments(process.argv.slice(2))
const result = await verifyReleaseCandidate(resolve(args.bundle), {
  ...(args.expectedCommit ? { expectedCommit: args.expectedCommit } : {}),
})

process.stdout.write(`Verified Metrora ${result.productVersion} candidate from ${result.sourceCommit}: ${result.fileCount} files, ${result.totalBytes} bytes, manifest ${result.manifestSha256}\n`)
