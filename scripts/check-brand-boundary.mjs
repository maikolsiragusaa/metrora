#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)

// The legal provenance notice is the single public source of truth for the
// incorporated upstream snapshot. Product-facing surfaces must not repeat the
// upstream project identity as current Metrora branding or narrative.
const provenanceFiles = new Set([
  'LICENSES/UPSTREAM-MIT.txt',
  'THIRD_PARTY_NOTICES.md',
])

const provenance = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
const sourceRepository = provenance.match(/Source repository:\s*`?https:\/\/github\.com\/[^/\s`]+\/([^/\s`]+)`?/i)
if (!sourceRepository?.[1]) {
  console.error('Third-party provenance must include the incorporated source repository.')
  process.exit(1)
}
const incorporatedProjectName = sourceRepository[1].toLowerCase()
const violations = []

for (const path of files) {
  if (path.startsWith('scripts/')) continue
  if (provenanceFiles.has(path)) continue
  if (/(?:^|[./])(?:node_modules|dist|build|release)(?:[./]|$)/i.test(path)) continue
  if (/(?:\.test\.|\.snap$)/i.test(path)) continue

  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  if (content.toLowerCase().includes(incorporatedProjectName)) violations.push(path)
}

if (violations.length) {
  console.error(`Upstream project identity escaped the legal provenance boundary:\n${violations.join('\n')}`)
  process.exit(1)
}

console.log('Metrora public product identity boundary passed; upstream identity is confined to legal provenance.')
