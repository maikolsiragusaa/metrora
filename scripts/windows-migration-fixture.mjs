import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const packageFiles = Object.freeze([
  { path: 'package.json', name: 'metrora' },
  { path: 'package-lock.json', name: 'metrora', lock: true },
  { path: 'app/package.json', name: 'metrora-desktop' },
  { path: 'app/package-lock.json', name: 'metrora-desktop', lock: true },
])

function assertVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`migration fixture version must be strict semver: ${value}`)
  }
}

function rewritePackage(document, expectedName, version, lock) {
  if (document.name !== expectedName) {
    throw new Error(`unexpected package name: expected ${expectedName}, received ${document.name}`)
  }
  if (typeof document.version !== 'string') {
    throw new Error(`${expectedName} package version is missing`)
  }
  const originalVersion = document.version
  document.version = version

  if (lock) {
    const root = document.packages?.['']
    if (!root || root.name !== expectedName || typeof root.version !== 'string') {
      throw new Error(`${expectedName} package-lock root is invalid`)
    }
    if (root.version !== originalVersion) {
      throw new Error(`${expectedName} package-lock root version does not match package version`)
    }
    root.version = version
  }
  return originalVersion
}

export async function prepareWindowsMigrationFixture(options) {
  const repository = resolve(options.repository)
  assertVersion(options.version)
  const originalVersions = new Set()
  const updates = []

  for (const entry of packageFiles) {
    const path = join(repository, entry.path)
    const document = JSON.parse(await readFile(path, 'utf8'))
    const originalVersion = rewritePackage(document, entry.name, options.version, entry.lock)
    originalVersions.add(originalVersion)
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    updates.push({ path: entry.path, name: entry.name, originalVersion, fixtureVersion: options.version })
  }

  if (originalVersions.size !== 1) {
    throw new Error(`migration source package versions are inconsistent: ${[...originalVersions].join(', ')}`)
  }
  return {
    repository,
    sourceVersion: [...originalVersions][0],
    fixtureVersion: options.version,
    updates,
  }
}
