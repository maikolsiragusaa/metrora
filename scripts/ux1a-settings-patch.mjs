import fs from 'node:fs'

const settingsPath = 'app/renderer/sections/Settings.tsx'
const workflowPath = '.github/workflows/ux1a-settings-patch.yml'
const scriptPath = 'scripts/ux1a-settings-patch.mjs'
let source = fs.readFileSync(settingsPath, 'utf8')

function replaceOnce(from, to) {
  const first = source.indexOf(from)
  if (first < 0) throw new Error(`Expected Settings source fragment was not found: ${from.slice(0, 80)}`)
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Settings source fragment was not unique: ${from.slice(0, 80)}`)
  source = source.replace(from, to)
}

replaceOnce(
  "import { REFRESH_OPTIONS, useRefreshCadence } from '../lib/refreshCadence'\n",
  "import { REFRESH_OPTIONS, useRefreshCadence } from '../lib/refreshCadence'\nimport { shortcutLabel, shortcutRangeLabel } from '../lib/shortcuts'\n",
)

replaceOnce(
  "<Hint items={[{ k: '⌘1-7', label: 'Navigate' }, { k: '⌘R', label: 'Refresh' }]} right=\"pairing uses mutual TLS · approve-style, no PIN\" />",
  "<Hint items={[{ k: shortcutRangeLabel('1', '9'), label: 'Navigate' }, { k: shortcutLabel('R'), label: 'Refresh' }]} right=\"pairing uses mutual TLS · approve-style, no PIN\" />",
)

replaceOnce(
  'Applies to the overview data. Manage config folders with the compatibility CLI (`codeburn`).',
  'Applies only to views backed by the scoped Overview data. Configuration folders are managed by the Metrora CLI.',
)

replaceOnce(
  'How often data auto-refreshes. Manual updates only on ⌘R.',
  "How often data auto-refreshes. Manual updates use {shortcutLabel('R')}.",
)

replaceOnce(
  'To pair a device, run the compatibility command <code>codeburn devices add</code> in a terminal.',
  'To pair a device, run <code>metrora devices add</code> in a terminal.',
)

replaceOnce(
  'This build does not transmit product telemetry or query inherited CodeBurn update services.',
  'This build does not transmit product telemetry or query legacy update services.',
)

fs.writeFileSync(settingsPath, source)
fs.rmSync(workflowPath)
fs.rmSync(scriptPath)
