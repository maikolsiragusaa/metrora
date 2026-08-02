import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyWindowsInstalledStateInventories } from './windows-installed-state-classifier.mjs'

function entry(path, marker) {
  return { path, size: marker.length, sha256: marker.padEnd(64, '0').slice(0, 64) }
}

const baseline = [entry('Metrora.exe', 'baseline-exe'), entry('resources/app.asar', 'baseline-asar')]
const candidate = [entry('Metrora.exe', 'candidate-exe'), entry('resources/app.asar', 'candidate-asar')]
const installerExtras = [entry('Uninstall Metrora.exe', 'uninstaller'), entry('resources/elevate.exe', 'elevate')]

test('classifies an exact historical payload while ignoring declared installer files', () => {
  const result = classifyWindowsInstalledStateInventories({
    baseline,
    candidate,
    installed: [...baseline, ...installerExtras],
  })
  assert.equal(result.classification, 'baseline-complete')
  assert.equal(result.baselineComparison.exact, true)
  assert.equal(result.candidateComparison.exact, false)
})

test('classifies an exact current payload while ignoring declared installer files', () => {
  const result = classifyWindowsInstalledStateInventories({
    baseline,
    candidate,
    installed: [...candidate, ...installerExtras],
  })
  assert.equal(result.classification, 'candidate-complete')
  assert.equal(result.candidateComparison.exact, true)
})

test('classifies a directory with no product payload as absent', () => {
  const result = classifyWindowsInstalledStateInventories({
    baseline,
    candidate,
    installed: installerExtras,
  })
  assert.equal(result.classification, 'absent')
  assert.equal(result.installedProductFileCount, 0)
})

test('classifies a partially replaced payload as mixed', () => {
  const result = classifyWindowsInstalledStateInventories({
    baseline,
    candidate,
    installed: [candidate[0], baseline[1], ...installerExtras],
  })
  assert.equal(result.classification, 'mixed')
  assert.deepEqual(result.baselineComparison.changed, ['Metrora.exe'])
  assert.deepEqual(result.candidateComparison.changed, ['resources/app.asar'])
})

test('classifies undeclared product files as mixed', () => {
  const result = classifyWindowsInstalledStateInventories({
    baseline,
    candidate,
    installed: [...candidate, entry('unexpected.bin', 'unexpected'), ...installerExtras],
  })
  assert.equal(result.classification, 'mixed')
  assert.deepEqual(result.candidateComparison.extra, ['unexpected.bin'])
})

test('does not choose an authority when baseline and candidate inventories are identical', () => {
  const result = classifyWindowsInstalledStateInventories({
    baseline,
    candidate: baseline,
    installed: [...baseline, ...installerExtras],
  })
  assert.equal(result.classification, 'mixed')
  assert.equal(result.baselineComparison.exact, true)
  assert.equal(result.candidateComparison.exact, true)
})
