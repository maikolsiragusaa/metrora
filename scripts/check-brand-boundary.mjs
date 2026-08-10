#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)

// Provenance notices are deliberately outside the user-facing scan. They are
// the narrow technical/legal boundaries documented in the repository notices.
const compatibilityFiles = new Set()
const provenanceFiles = new Set([
  'LICENSES/UPSTREAM-MIT.txt',
  'THIRD_PARTY_NOTICES.md',
])

const legacyBrand = String.fromCharCode(99, 111, 100, 101, 98, 117, 114, 110)
const violations = []

for (const path of files) {
  if (path.startsWith('scripts/')) continue
  if (compatibilityFiles.has(path) || provenanceFiles.has(path)) continue
  if (/(?:^|[./])(?:node_modules|dist|build|release)(?:[./]|$)/i.test(path)) continue
  if (/(?:\.test\.|\.snap$)/i.test(path)) continue

  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  if (content.toLowerCase().includes(legacyBrand)) violations.push(path)
}

if (violations.length) {
  console.error(`Legacy identity escaped the current product-facing boundary:\n${violations.join('\n')}`)
  process.exit(1)
}

console.log('Metrora public product identity boundary passed; user-facing legacy occurrences: 0.')
