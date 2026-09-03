#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)

// Legal provenance is the source of truth for upstream identity. The boundary
// protects incorporated runtime/component names while allowing reference-only
// runtimes (for example, an explicitly supported external engine) to retain
// their factual name in product documentation.
const provenanceFiles = new Set([
  'LICENSES/UPSTREAM-MIT.txt',
  'THIRD_PARTY_NOTICES.md',
])
const manifestPath = /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock)$/iu
const legalStagingFiles = new Set([
  // This build helper copies the named licence into the packaged legal
  // payload. It is provenance plumbing, not product branding.
  'app/scripts/stage-cli.mjs',
])

const provenance = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
const entries = [...provenance.matchAll(/(?:^|\n)##\s+([^\n]+)[\s\S]*?Source repository:\s*`?(https:\/\/github\.com\/[^/\s`]+\/[^/\s`]+)`?/giu)]
  .map(match => ({ heading: match[1], repository: match[2] }))
if (entries.length === 0) {
  console.error('Third-party provenance must include at least one incorporated source repository.')
  process.exit(1)
}

// Only entries describing incorporated runtime/component material define the
// product-identity boundary. Reference-only or user-supplied external
// runtimes remain legitimate factual identities in their own contracts.
const protectedIdentities = entries
  .filter(entry => /(?:runtime substrate|incorporated|component)/iu.test(entry.heading))
  .map(entry => entry.repository.replace(/\.git$/iu, '').split('/').at(-1) ?? '')
  .filter(Boolean)
if (protectedIdentities.length === 0) {
  console.error('Third-party provenance must identify an incorporated runtime or component.')
  process.exit(1)
}

function identityPattern(identity) {
  const pieces = identity.split(/[-_.\s]+/u).filter(Boolean).map(piece => piece.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  return new RegExp(`(?:${pieces.join('[-_.\\s]+')})`, 'iu')
}

const identityPatterns = protectedIdentities.map(identityPattern)
const violations = []

for (const file of files) {
  if (file.startsWith('scripts/')) continue
  if (provenanceFiles.has(file) || file.startsWith('LICENSES/')) continue
  if (manifestPath.test(file) || legalStagingFiles.has(file)) continue
  if (/(?:^|[./])(?:node_modules|dist|build|release)(?:[./]|$)/iu.test(file)) continue
  if (/(?:\.test\.|\.snap$)/iu.test(file)) continue

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (identityPatterns.some(pattern => pattern.test(content))) violations.push(file)
}

if (violations.length) {
  console.error(`Incorporated upstream identity escaped the legal provenance boundary:\n${violations.join('\n')}`)
  process.exit(1)
}

console.log(`Metrora public product identity boundary passed; ${entries.length} upstream provenance entries remain classified.`)
