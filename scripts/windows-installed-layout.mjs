import { resolve } from 'node:path'

import { collectPayloadInventory } from './windows-release-manifest-lib.mjs'

const allowedInstalledExtras = Object.freeze([
  'Uninstall Metrora.exe',
  'resources/elevate.exe',
])

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export async function verifyWindowsInstalledLayout(options) {
  const canonical = await collectPayloadInventory(resolve(options.canonicalDirectory))
  const installed = await collectPayloadInventory(resolve(options.installedDirectory))
  const remainingCanonical = new Map(canonical.map(entry => [entry.path, entry]))
  const extras = []

  for (const entry of installed) {
    const expected = remainingCanonical.get(entry.path)
    if (!expected) {
      extras.push(entry)
      continue
    }
    if (entry.size !== expected.size || entry.sha256 !== expected.sha256) {
      throw new Error(`installed application changed canonical product file: ${entry.path}`)
    }
    remainingCanonical.delete(entry.path)
  }

  if (remainingCanonical.size > 0) {
    throw new Error(`installed application is missing canonical product file: ${remainingCanonical.keys().next().value}`)
  }

  extras.sort((left, right) => compareText(left.path, right.path))
  const extraPaths = extras.map(entry => entry.path)
  if (JSON.stringify(extraPaths) !== JSON.stringify(allowedInstalledExtras)) {
    throw new Error(`installed application extra-file set is invalid: ${extraPaths.join(', ') || '(none)'}`)
  }
  if (extras.some(entry => entry.size < 1)) {
    throw new Error('installed application contains an empty format-specific file')
  }

  return {
    canonicalFileCount: canonical.length,
    installedFileCount: installed.length,
    extras,
  }
}
