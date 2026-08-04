#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ownPath = relative(repositoryRoot, fileURLToPath(import.meta.url)).replaceAll('\\', '/')
const protectedPersonalIdentityDigest = 'c1f0ebf4926c5f2dc4823b9b747a1ae15a9916c59f02049bc913bc133a9c4f8c'

const globallyForbidden = [
  {
    value: ['metrora', 'infra'].join('-'),
    message: 'private infrastructure repository identity must not appear publicly',
  },
  {
    value: ['metrora', 'commercial'].join('-'),
    message: 'private commercial repository identity must not appear publicly',
  },
  ...['Ltd', 'LLC', 'Inc.', 'S.r.l.', 'GmbH'].map(suffix => ({
    value: ['Vensent', suffix].join(' '),
    message: 'Vensent must not be represented as a separate incorporated entity without verified legal status',
  })),
  ...['Metrora', 'Vensent', 'Signal Grid'].map(name => ({
    value: `${name}®`,
    message: 'brand symbols must match the canonical public brand policy',
  })),
]

const presentationFiles = [
  'README.md',
  'NOTICE.md',
  'BRAND_POLICY.md',
  'UPSTREAM.md',
  'CONTRIBUTING.md',
  'assets/brand/README.md',
  'docs/PRODUCT_PRINCIPLES.md',
]

const presentationForbidden = [
  'No registered-trade-mark claim',
  'Do not add the `®`',
  'under active development',
  'hosted synchronization',
  'customer-operated',
  'managed service',
  'private deployment',
  'enterprise deployment',
  'Partner Center',
  'zero monetary spend',
  'Full Ubuntu Vitest audit: failure',
  'Upstream Semgrep guard',
  'Upstream CLI build',
  'Commercial value may come from',
  'early in its independent development',
  'platform-sensitive failures on Ubuntu',
]

function containsProtectedPersonalIdentity(line) {
  const tokens = line.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const digest = createHash('sha256')
      .update(`${tokens[index]} ${tokens[index + 1]}`, 'utf8')
      .digest('hex')
    if (digest === protectedPersonalIdentityDigest) return true
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
    if (containsProtectedPersonalIdentity(lines[index])) {
      findings.push({
        path: normalized,
        line: index + 1,
        message: 'protected personal identity must not appear in ordinary public repository surfaces',
      })
    }
    for (const rule of globallyForbidden) {
      if (!lines[index].includes(rule.value)) continue
      findings.push({ path: normalized, line: index + 1, message: rule.message })
    }
  }
}

for (const path of presentationFiles) {
  const text = readTrackedText(path)
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    for (const value of presentationForbidden) {
      if (!lines[index].includes(value)) continue
      findings.push({
        path,
        line: index + 1,
        message: 'public presentation must not expose defensive, administrative or unpublished roadmap wording',
      })
    }
  }
}

const requiredFiles = {
  'LICENSE': [
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
}

for (const [path, markers] of Object.entries(requiredFiles)) {
  const text = readTrackedText(path)
  for (const marker of markers) {
    if (text.includes(marker)) continue
    findings.push({ path, line: 1, message: `required canonical public marker is missing: ${marker}` })
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

console.log(`Public identity and repository hygiene boundary passed across ${tracked.length} tracked files.`)
