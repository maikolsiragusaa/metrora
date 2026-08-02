import { resolve } from 'node:path'

import { collectPayloadInventory } from './windows-release-manifest-lib.mjs'

const ignoredInstallerPaths = new Set([
  'Uninstall Metrora.exe',
  'resources/elevate.exe',
])

function inventoryMap(entries) {
  return new Map(entries.map(entry => [entry.path, entry]))
}

function sameEntry(left, right) {
  return left?.size === right?.size && left?.sha256 === right?.sha256
}

function compareInventory(expectedEntries, actualEntries) {
  const expected = inventoryMap(expectedEntries)
  const actual = inventoryMap(actualEntries)
  const missing = []
  const changed = []
  const extra = []

  for (const [path, expectedEntry] of expected) {
    const actualEntry = actual.get(path)
    if (!actualEntry) missing.push(path)
    else if (!sameEntry(expectedEntry, actualEntry)) changed.push(path)
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) extra.push(path)
  }

  missing.sort()
  changed.sort()
  extra.sort()
  return {
    exact: missing.length === 0 && changed.length === 0 && extra.length === 0,
    missing,
    changed,
    extra,
  }
}

export function classifyWindowsInstalledStateInventories(options) {
  const installedProduct = options.installed.filter(entry => !ignoredInstallerPaths.has(entry.path))
  const baselineComparison = compareInventory(options.baseline, installedProduct)
  const candidateComparison = compareInventory(options.candidate, installedProduct)

  if (installedProduct.length === 0) {
    return {
      classification: 'absent',
      installedProductFileCount: 0,
      baselineComparison,
      candidateComparison,
    }
  }

  if (baselineComparison.exact && !candidateComparison.exact) {
    return {
      classification: 'baseline-complete',
      installedProductFileCount: installedProduct.length,
      baselineComparison,
      candidateComparison,
    }
  }

  if (candidateComparison.exact && !baselineComparison.exact) {
    return {
      classification: 'candidate-complete',
      installedProductFileCount: installedProduct.length,
      baselineComparison,
      candidateComparison,
    }
  }

  return {
    classification: 'mixed',
    installedProductFileCount: installedProduct.length,
    baselineComparison,
    candidateComparison,
  }
}

export async function classifyWindowsInstalledState(options) {
  const [baseline, candidate, installed] = await Promise.all([
    collectPayloadInventory(resolve(options.baselineDirectory)),
    collectPayloadInventory(resolve(options.candidateDirectory)),
    collectPayloadInventory(resolve(options.installedDirectory)),
  ])
  return classifyWindowsInstalledStateInventories({ baseline, candidate, installed })
}
