#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function readTrackedText(path) {
  const bytes = readFileSync(resolve(repositoryRoot, path))
  if (bytes.includes(0)) return null
  return bytes.toString('utf8')
}

const findings = []
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

console.log('Canonical public identity, licensing and contribution markers are present.')
