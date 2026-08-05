import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { verifyWindowsInstalledLayout } from './windows-installed-layout.mjs'

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'metrora-installed-layout-'))
  const canonical = join(root, 'canonical')
  const installed = join(root, 'installed')
  await mkdir(join(canonical, 'resources'), { recursive: true })
  await writeFile(join(canonical, 'Metrora.exe'), 'exe')
  await writeFile(join(canonical, 'resources', 'app.asar'), 'asar')
  await cp(canonical, installed, { recursive: true })
  await writeFile(join(installed, 'Uninstall Metrora.exe'), 'uninstaller')
  await writeFile(join(installed, 'resources', 'elevate.exe'), 'elevate-helper')
  try {
    await run({ canonical, installed })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('accepts canonical product files plus explicit NSIS installation files', async () => {
  await withFixture(async ({ canonical, installed }) => {
    const result = await verifyWindowsInstalledLayout({
      canonicalDirectory: canonical,
      installedDirectory: installed,
    })
    assert.equal(result.canonicalFileCount, 2)
    assert.equal(result.installedFileCount, 4)
    assert.deepEqual(result.extras.map(entry => entry.path), [
      'Uninstall Metrora.exe',
      'resources/elevate.exe',
    ])
  })
})

test('rejects mutation of an installed canonical file', async () => {
  await withFixture(async ({ canonical, installed }) => {
    await writeFile(join(installed, 'Metrora.exe'), 'changed')
    await assert.rejects(
      verifyWindowsInstalledLayout({
        canonicalDirectory: canonical,
        installedDirectory: installed,
      }),
      /changed canonical product file: Metrora\.exe/,
    )
  })
})

test('rejects a missing installed canonical file', async () => {
  await withFixture(async ({ canonical, installed }) => {
    await rm(join(installed, 'resources', 'app.asar'))
    await assert.rejects(
      verifyWindowsInstalledLayout({
        canonicalDirectory: canonical,
        installedDirectory: installed,
      }),
      /missing canonical product file: resources\/app\.asar/,
    )
  })
})

test('rejects undeclared installed files', async () => {
  await withFixture(async ({ canonical, installed }) => {
    await writeFile(join(installed, 'unexpected.dll'), 'unexpected')
    await assert.rejects(
      verifyWindowsInstalledLayout({
        canonicalDirectory: canonical,
        installedDirectory: installed,
      }),
      /extra-file set is invalid/,
    )
  })
})

test('requires both expected NSIS installation files', async () => {
  await withFixture(async ({ canonical, installed }) => {
    await rm(join(installed, 'resources', 'elevate.exe'))
    await assert.rejects(
      verifyWindowsInstalledLayout({
        canonicalDirectory: canonical,
        installedDirectory: installed,
      }),
      /extra-file set is invalid/,
    )
  })
})
