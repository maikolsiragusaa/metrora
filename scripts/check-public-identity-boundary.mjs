#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
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
const trackedFiles = execFileSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)

// Assemble the retired marker without spelling it in the checker: the current
// tree invariant is that the marker itself is absent everywhere.
const retiredNamespace = String.fromCharCode(113, 111, 118, 114, 105, 111, 110)
for (const path of trackedFiles) {
  const text = readTrackedText(path)
  if (path.toLowerCase().includes(retiredNamespace) || text?.toLowerCase().includes(retiredNamespace)) {
    findings.push({ path, line: 1, message: 'retired namespace must not appear in the current tree' })
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
    'Metrora',
    'Signal Grid',
    'Vensent',
    'Copyright',
  ],
  'BRAND_POLICY.md': [
    'Metrora',
    'Signal Grid',
    'Vensent',
  ],
  'README.md': [
    'Metrora `1.0.0-rc.7` is available as an **unsigned Windows x64 technical preview**',
    'https://github.com/maikolsiragusaa/metrora/releases/tag/v1.0.0-rc.7',
    'Metrora is independently maintained',
  ],
  'app/renderer/components/AboutModal.tsx': [
    'Metrora',
    'Updates are handled by the active distribution channel',
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
    if (text?.includes(marker)) continue
    findings.push({ path, line: 1, message: `required public-boundary marker is missing: ${marker}` })
  }
}

const forbiddenStoreSurfaceMarkers = {
  'app/renderer/components/AboutModal.tsx': [
    '0.9.19',
  ],
}

for (const [path, markers] of Object.entries(forbiddenStoreSurfaceMarkers)) {
  const text = readTrackedText(path) ?? ''
  for (const marker of markers) {
    if (text.includes(marker)) {
      findings.push({ path, line: 1, message: `historical marker must not appear on the Store-facing surface: ${marker}` })
    }
  }
}

const rootLicense = readTrackedText('LICENSE') ?? ''
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

console.log('Canonical public identity, licensing, Store-facing and current-tree markers are present.')
