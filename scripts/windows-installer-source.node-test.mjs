import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { verifyWindowsInstallerSource } from './windows-installer-source.mjs'

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'metrora-installer-source-'))
  const canonical = join(root, 'canonical')
  const installerSource = join(root, 'installer-source')
  await mkdir(join(canonical, 'resources'), { recursive: true })
  await writeFile(join(canonical, 'Metrora.exe'), 'exe')
  await writeFile(join(canonical, 'resources', 'app.asar'), 'asar')
  await cp(canonical, installerSource, { recursive: true })
  try {
    await run({ canonical, installerSource })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function addElevate(installerSource) {
  await writeFile(join(installerSource, 'resources', 'elevate.exe'), 'elevate-helper')
}

test('accepts an exact canonical copy plus the NSIS elevation helper', async () => {
  await withFixture(async ({ canonical, installerSource }) => {
    await addElevate(installerSource)
    const result = await verifyWindowsInstallerSource({
      canonicalDirectory: canonical,
      installerSourceDirectory: installerSource,
    })
    assert.equal(result.canonicalFileCount, 2)
    assert.equal(result.installerSourceFileCount, 3)
    assert.deepEqual(result.additions.map(entry => entry.path), ['resources/elevate.exe'])
  })
})

test('rejects mutation of a canonical product file', async () => {
  await withFixture(async ({ canonical, installerSource }) => {
    await addElevate(installerSource)
    await writeFile(join(installerSource, 'Metrora.exe'), 'changed')
    await assert.rejects(
      verifyWindowsInstallerSource({
        canonicalDirectory: canonical,
        installerSourceDirectory: installerSource,
      }),
      /changed canonical product file: Metrora\.exe/,
    )
  })
})

test('rejects removal of a canonical product file', async () => {
  await withFixture(async ({ canonical, installerSource }) => {
    await addElevate(installerSource)
    await rm(join(installerSource, 'resources', 'app.asar'))
    await assert.rejects(
      verifyWindowsInstallerSource({
        canonicalDirectory: canonical,
        installerSourceDirectory: installerSource,
      }),
      /missing canonical product file: resources\/app\.asar/,
    )
  })
})

test('rejects an unexpected installer-source addition', async () => {
  await withFixture(async ({ canonical, installerSource }) => {
    await addElevate(installerSource)
    await writeFile(join(installerSource, 'unexpected.dll'), 'unexpected')
    await assert.rejects(
      verifyWindowsInstallerSource({
        canonicalDirectory: canonical,
        installerSourceDirectory: installerSource,
      }),
      /addition set is invalid: resources\/elevate\.exe, unexpected\.dll/,
    )
  })
})

test('requires the expected NSIS helper addition', async () => {
  await withFixture(async ({ canonical, installerSource }) => {
    await assert.rejects(
      verifyWindowsInstallerSource({
        canonicalDirectory: canonical,
        installerSourceDirectory: installerSource,
      }),
      /addition set is invalid: \(none\)/,
    )
  })
})
