import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { prepareWindowsMigrationFixture } from './windows-migration-fixture.mjs'

async function writePackage(root, relativePath, name, version, lock = false) {
  const path = join(root, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  const document = lock
    ? { name, version, lockfileVersion: 3, packages: { '': { name, version } } }
    : { name, version, private: true }
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`)
}

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'metrora-migration-fixture-'))
  await writePackage(root, 'package.json', 'metrora', '0.9.19')
  await writePackage(root, 'package-lock.json', 'metrora', '0.9.19', true)
  await writePackage(root, 'app/package.json', 'metrora-desktop', '0.9.19')
  await writePackage(root, 'app/package-lock.json', 'metrora-desktop', '0.9.19', true)
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('rewrites root and desktop package identities to one fixture version', async () => {
  await withFixture(async root => {
    const result = await prepareWindowsMigrationFixture({ repository: root, version: '0.9.18' })
    assert.equal(result.sourceVersion, '0.9.19')
    assert.equal(result.fixtureVersion, '0.9.18')
    assert.equal(result.updates.length, 4)

    for (const relativePath of ['package.json', 'package-lock.json', 'app/package.json', 'app/package-lock.json']) {
      const document = JSON.parse(await readFile(join(root, relativePath), 'utf8'))
      assert.equal(document.version, '0.9.18')
      if (relativePath.endsWith('package-lock.json')) assert.equal(document.packages[''].version, '0.9.18')
    }
  })
})

test('rejects non-semver fixture versions', async () => {
  await withFixture(async root => {
    await assert.rejects(
      prepareWindowsMigrationFixture({ repository: root, version: '0.9.18-r1bc' }),
      /strict semver/,
    )
  })
})

test('rejects inconsistent source package versions', async () => {
  await withFixture(async root => {
    await writePackage(root, 'app/package.json', 'metrora-desktop', '0.9.17')
    await writePackage(root, 'app/package-lock.json', 'metrora-desktop', '0.9.17', true)
    await assert.rejects(
      prepareWindowsMigrationFixture({ repository: root, version: '0.9.18' }),
      /source package versions are inconsistent/,
    )
  })
})

test('rejects a package-lock whose root version disagrees', async () => {
  await withFixture(async root => {
    const path = join(root, 'package-lock.json')
    const document = JSON.parse(await readFile(path, 'utf8'))
    document.packages[''].version = '0.9.17'
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`)
    await assert.rejects(
      prepareWindowsMigrationFixture({ repository: root, version: '0.9.18' }),
      /package-lock root version does not match/,
    )
  })
})
