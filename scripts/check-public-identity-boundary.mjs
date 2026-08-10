#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function readTrackedText(path) {
  try {
    const bytes = readFileSync(resolve(repositoryRoot, path))
    if (bytes.includes(0)) return null
    return bytes.toString('utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

const findings = []

// First-party technical identities are asserted positively. The public tree
// records what Metrora is today; it does not keep a blacklist of retired names
// or inherited authorities.
const canonicalTechnicalIdentity = {
  'mac/Scripts/build-local.sh': [
    'BUNDLE_ID="eu.metrora.menubar"',
  ],
  'mac/Scripts/package-app.sh': [
    'BUNDLE_ID="eu.metrora.menubar"',
  ],
  'src/menubar-installer.ts': [
    "METRORA_MENUBAR_BUNDLE_ID = 'eu.metrora.menubar'",
  ],
  'mac/Sources/MetroraMenubar/MetroraApp.swift': [
    'identifier: "eu.metrora.menubar.refresh-backstop"',
  ],
  'app/electron/quota/codex.ts': [
    "MENUBAR_KEYCHAIN_SERVICE = 'eu.metrora.menubar.codex.oauth.v1'",
  ],
}

for (const [path, markers] of Object.entries(canonicalTechnicalIdentity)) {
  const text = readTrackedText(path) ?? ''
  for (const marker of markers) {
    if (text.includes(marker)) continue
    findings.push({ path, line: 1, message: `canonical first-party technical identity marker is missing: ${marker}` })
  }
}

const requiredFiles = {
  LICENSE: [
    'Copyright (c) 2026 Metrora contributors',
  ],
  'LICENSES/UPSTREAM-MIT.txt': [
    'MIT License',
    'Permission is hereby granted',
  ],
  'THIRD_PARTY_NOTICES.md': [
    'LICENSES/UPSTREAM-MIT.txt',
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

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`::error file=${finding.path},line=${finding.line}::${finding.message}`)
  }
  process.exit(1)
}

console.log('Canonical public identity, licensing, Store-facing and current-tree markers are present.')
