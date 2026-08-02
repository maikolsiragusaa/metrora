import { resolve } from 'node:path'

import { collectPayloadInventory } from './windows-release-manifest-lib.mjs'

const allowedInstallerSourceExtras = Object.freeze([
  'resources/elevate.exe',
])

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export async function verifyWindowsInstallerSource(options) {
  const canonical = await collectPayloadInventory(resolve(options.canonicalDirectory))
  const installerSource = await collectPayloadInventory(resolve(options.installerSourceDirectory))
  const remainingCanonical = new Map(canonical.map(entry => [entry.path, entry]))
  const additions = []

  for (const entry of installerSource) {
    const expected = remainingCanonical.get(entry.path)
    if (!expected) {
      additions.push(entry)
      continue
    }
    if (entry.size !== expected.size || entry.sha256 !== expected.sha256) {
      throw new Error(`NSIS prepackaged source changed canonical product file: ${entry.path}`)
    }
    remainingCanonical.delete(entry.path)
  }

  if (remainingCanonical.size > 0) {
    throw new Error(`NSIS prepackaged source is missing canonical product file: ${remainingCanonical.keys().next().value}`)
  }

  additions.sort((left, right) => compareText(left.path, right.path))
  const additionPaths = additions.map(entry => entry.path)
  if (JSON.stringify(additionPaths) !== JSON.stringify(allowedInstallerSourceExtras)) {
    throw new Error(`NSIS prepackaged source addition set is invalid: ${additionPaths.join(', ') || '(none)'}`)
  }
  if (additions.some(entry => entry.size < 1)) {
    throw new Error('NSIS prepackaged source contains an empty installer helper')
  }

  return {
    canonicalFileCount: canonical.length,
    installerSourceFileCount: installerSource.length,
    additions,
  }
}
