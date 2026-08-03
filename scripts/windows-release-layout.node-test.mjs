import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { writeReleaseMetadata } from './windows-release-manifest-lib.mjs'
import {
  finalizeWindowsCandidateLayout,
  prepareWindowsCandidateLayout,
  verifyWindowsCandidateLayout,
} from './windows-release-layout.mjs'

const sourceCommit = '1'.repeat(40)
const sourceTree = '2'.repeat(40)

async function write(path, content) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'metrora-release-layout-'))
  const repositoryRoot = join(root, 'repo')
  const payloadDirectory = join(root, 'win-unpacked')
  const candidateDirectory = join(root, 'candidate')

  await write(join(repositoryRoot, 'package.json'), '{"name":"metrora"}\n')
  await write(join(repositoryRoot, 'package-lock.json'), '{"lockfileVersion":3}\n')
  await write(join(repositoryRoot, '.github', 'workflows', 'windows-portable.yml'), 'name: fixture\n')
  await write(join(repositoryRoot, 'assets', 'brand', 'README.md'), '# Signal Grid v1.0\n')
  await write(
    join(repositoryRoot, 'release', 'windows-release-candidate-manifest.v1.schema.json'),
    '{"title":"candidate fixture schema"}\n',
  )
  await write(
    join(repositoryRoot, 'release', 'windows-format-derivation.v1.schema.json'),
    '{"title":"format fixture schema"}\n',
  )
  await write(join(repositoryRoot, 'app', 'package.json'), JSON.stringify({
    name: 'metrora-desktop',
    version: '0.9.19',
    homepage: 'https://metrora.eu',
    publisher: 'Vensent',
    author: 'Vensent (https://metrora.eu)',
    build: { appId: 'eu.metrora.desktop', productName: 'Metrora' },
  }))
  await write(join(repositoryRoot, 'app', 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/electron': { version: '43.1.0' },
      'node_modules/electron-builder': { version: '26.15.3' },
    },
  }))

  await write(join(payloadDirectory, 'Metrora.exe'), 'canonical-desktop')
  await write(join(payloadDirectory, 'resources', 'app.asar'), 'canonical-renderer')
  await write(join(payloadDirectory, 'resources', 'cli', 'dist', 'main.js'), 'canonical-cli')

  await prepareWindowsCandidateLayout({ payloadDirectory, candidateDirectory })
  const portable = join(candidateDirectory, 'portable')
  await write(join(portable, 'README.txt'), 'unsigned fixture')
  await write(join(portable, 'Run-Metrora-Baseline.cmd'), '@echo off\n')
  await write(join(portable, 'Run-Metrora-Baseline.ps1'), 'Write-Host fixture\n')
  await writeReleaseMetadata({
    repositoryRoot,
    bundleDirectory: portable,
    sourceFileMode: 'working-tree',
    sourceCommit,
    sourceTree,
    sourceDateEpoch: '1785664800',
    distribution: 'unsigned-development-artifact',
    attestation: {
      provider: 'test',
      workflow: 'fixture',
      runId: '1',
      runAttempt: '1',
      ref: 'refs/heads/test',
      builtAt: '2026-08-02T10:00:00.000Z',
      runnerOs: 'test',
      runnerImage: 'fixture',
    },
  })
  await write(join(candidateDirectory, 'installer', 'Metrora-Setup-0.9.19.exe'), 'fixture-installer')

  return { root, repositoryRoot, payloadDirectory, candidateDirectory, portable }
}

function options(fx) {
  return {
    repositoryRoot: fx.repositoryRoot,
    payloadDirectory: fx.payloadDirectory,
    candidateDirectory: fx.candidateDirectory,
    expectedCommit: sourceCommit,
    sourceFileMode: 'working-tree',
  }
}

test('finalizes and verifies portable and installer from one canonical payload', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))

  const result = await finalizeWindowsCandidateLayout(options(fx))

  assert.equal(result.productVersion, '0.9.19')
  assert.equal(result.canonicalFileCount, 3)
  assert.deepEqual(result.installerFiles, ['Metrora-Setup-0.9.19.exe'])
})

test('rejects mutation of the prepackaged installer source', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await write(join(fx.payloadDirectory, 'Metrora.exe'), 'mutated-source')

  await assert.rejects(
    finalizeWindowsCandidateLayout(options(fx)),
    /prepackaged installer source does not match/,
  )
})

test('rejects a portable that changes a canonical product file', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await write(join(fx.portable, 'resources', 'app.asar'), 'mutated-portable')

  await assert.rejects(
    finalizeWindowsCandidateLayout(options(fx)),
    /portable changed canonical product file/,
  )
})

test('rejects an undeclared portable-only file', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await write(join(fx.portable, 'surprise.txt'), 'unexpected')

  await assert.rejects(
    finalizeWindowsCandidateLayout(options(fx)),
    /portable extra-file set is invalid/,
  )
})

test('requires exactly one canonical setup executable', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await rm(join(fx.candidateDirectory, 'installer', 'Metrora-Setup-0.9.19.exe'))

  await assert.rejects(
    finalizeWindowsCandidateLayout(options(fx)),
    /installer directory is empty/,
  )
})

test('detects installer modification after format finalization', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await finalizeWindowsCandidateLayout(options(fx))
  await write(join(fx.candidateDirectory, 'installer', 'Metrora-Setup-0.9.19.exe'), 'tampered')

  await assert.rejects(
    verifyWindowsCandidateLayout(options(fx)),
    /installer outputs do not match/,
  )
})
