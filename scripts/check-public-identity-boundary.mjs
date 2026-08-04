#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ownPath = relative(repositoryRoot, fileURLToPath(import.meta.url)).replaceAll('\\', '/')
const restrictedIdentifierDigest = 'c1f0ebf4926c5f2dc4823b9b747a1ae15a9916c59f02049bc913bc133a9c4f8c'
const canonicalRepository = 'metrora'

function containsRestrictedIdentifier(line) {
  const tokens = line.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const digest = createHash('sha256')
      .update(`${tokens[index]} ${tokens[index + 1]}`, 'utf8')
      .digest('hex')
    if (digest === restrictedIdentifierDigest) return true
  }
  return false
}

function readTrackedText(path) {
  const bytes = readFileSync(resolve(repositoryRoot, path))
  if (bytes.includes(0)) return null
  return bytes.toString('utf8')
}

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean)

const findings = []
for (const path of tracked) {
  const normalized = path.replaceAll('\\', '/')
  if (normalized === ownPath) continue

  let text
  try {
    text = readTrackedText(path)
  } catch (error) {
    findings.push({ path: normalized, line: 1, message: `tracked file could not be read: ${error.message}` })
    continue
  }

  if (text === null) continue
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (containsRestrictedIdentifier(line)) {
      findings.push({
        path: normalized,
        line: index + 1,
        message: 'restricted identifier must not appear in ordinary public repository surfaces',
      })
    }

    const repositoryReferences = line.matchAll(/https?:\/\/github\.com\/maikolsiragusaa\/([A-Za-z0-9_.-]+)/g)
    for (const match of repositoryReferences) {
      const repository = match[1].toLowerCase().replace(/\.git$/, '')
      if (repository === canonicalRepository) continue
      findings.push({
        path: normalized,
        line: index + 1,
        message: 'non-canonical repository reference must not appear in the public product repository',
      })
    }
  }
}

const requiredFiles = {
  LICENSE: [
    'Copyright (c) 2026 Metrora contributors',
  ],
  'LICENSES/CodeBurn-MIT.txt': [
    'Copyright (c) 2026 AgentSeal',
  ],
  'THIRD_PARTY_NOTICES.md': [
    'LICENSES/CodeBurn-MIT.txt',
    'LICENSES/Apache-2.0.txt',
  ],
  'NOTICE.md': [
    'Metrora™',
    'Signal Grid™',
    'Vensent™',
    'Copyright © 2026 Metrora contributors',
  ],
  'BRAND_POLICY.md': [
    'Metrora™',
    'Signal Grid™',
    'Vensent™',
  ],
  'README.md': [
    'Official desktop distribution is in preparation',
    'Metrora is independently maintained',
    'Metrora™ — published by Vensent™',
  ],
  'CONTRIBUTING.md': [
    '## Public repository hygiene',
  ],
  '.github/PULL_REQUEST_TEMPLATE.md': [
    '## Public boundary',
  ],
  '.github/ISSUE_TEMPLATE/bug_report.md': [
    'sanitized data',
  ],
  '.github/ISSUE_TEMPLATE/feature_request.md': [
    '## Public boundaries',
  ],
}

for (const [path, markers] of Object.entries(requiredFiles)) {
  const text = readTrackedText(path)
  for (const marker of markers) {
    if (text.includes(marker)) continue
    findings.push({ path, line: 1, message: `required public-boundary marker is missing: ${marker}` })
  }
}

const rootLicense = readTrackedText('LICENSE')
if (rootLicense.includes('AgentSeal')) {
  findings.push({
    path: 'LICENSE',
    line: 1,
    message: 'upstream copyright must remain scoped to its dedicated licence notice',
  })
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`::error file=${finding.path},line=${finding.line}::${finding.message}`)
  }
  process.exit(1)
}

console.log(`Public repository boundary passed across ${tracked.length} tracked files.`)
