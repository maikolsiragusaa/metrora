#!/usr/bin/env node

import process from 'node:process'
import { resolve } from 'node:path'

import { writeReleaseMetadata } from './windows-release-manifest-lib.mjs'

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`expected --name value arguments, received: ${argv.slice(index).join(' ')}`)
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

const args = parseArguments(process.argv.slice(2))
const repositoryRoot = resolve(args.get('--repository-root') ?? process.cwd())
const bundleDirectory = resolve(required(args, '--bundle'))
const builtAt = args.get('--built-at') ?? new Date().toISOString()

const { manifest, attestation } = await writeReleaseMetadata({
  repositoryRoot,
  bundleDirectory,
  sourceCommit: required(args, '--source-commit'),
  sourceTree: required(args, '--source-tree'),
  sourceDateEpoch: required(args, '--source-date-epoch'),
  distribution: args.get('--distribution') ?? 'unsigned-development-artifact',
  inputFiles: [
    '.github/workflows/windows-portable.yml',
    'app/package-lock.json',
    'app/package.json',
    'assets/brand/README.md',
    'package-lock.json',
    'package.json',
  ],
  attestation: {
    provider: args.get('--provider') ?? 'local',
    workflow: args.get('--workflow') ?? 'local',
    runId: args.get('--run-id') ?? 'local',
    runAttempt: args.get('--run-attempt') ?? '1',
    ref: args.get('--ref') ?? 'local',
    builtAt,
    runnerOs: args.get('--runner-os') ?? process.platform,
    runnerImage: args.get('--runner-image') ?? 'local',
  },
})

process.stdout.write(`${JSON.stringify({
  productVersion: manifest.product.version,
  sourceCommit: manifest.source.commit,
  fileCount: manifest.payload.fileCount,
  totalBytes: manifest.payload.totalBytes,
  manifestSha256: attestation.manifestSha256,
})}\n`)
