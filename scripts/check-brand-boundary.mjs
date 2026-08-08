#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)

// The compatibility layer and provenance notices are deliberately outside the
// user-facing scan. They are read-only technical/legal boundaries documented in
// docs/TECHNICAL_IDENTITY_COMPATIBILITY.md and the repository notices.
const compatibilityFiles = new Set([
  'app/electron/cli.ts',
  'app/electron/identity.ts',
  'app/renderer/lib/storage.ts',
  'package.json',
  'package-lock.json',
  'src/product-paths.ts',
])
const provenanceFiles = new Set([
  'LICENSES/CodeBurn-MIT.txt',
  'THIRD_PARTY_NOTICES.md',
  'UPSTREAM.md',
  'docs/PRODUCT_LINEAGE.md',
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
