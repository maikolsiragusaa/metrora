import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  sha256File,
  verifyReleaseCandidate,
  writeReleaseMetadata,
} from './windows-release-manifest-lib.mjs'

const sourceCommit = '1'.repeat(40)
const sourceTree = '2'.repeat(40)
const inputFiles = [
  '.github/workflows/windows-portable.yml',
  'app/package-lock.json',
  'app/package.json',
  'assets/brand/README.md',
  'package-lock.json',
  'package.json',
]

async function write(path, content) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'metrora-release-manifest-'))
  const repositoryRoot = join(root, 'repo')
  const bundleDirectory = join(root, 'bundle')
  const schemaPath = join(repositoryRoot, 'release', 'windows-release-candidate-manifest.v1.schema.json')

  await write(join(repositoryRoot, 'package.json'), '{"name":"metrora"}\n')
  await write(join(repositoryRoot, 'package-lock.json'), '{"lockfileVersion":3}\n')
  await write(join(repositoryRoot, '.github', 'workflows', 'windows-portable.yml'), 'name: fixture\n')
  await write(join(repositoryRoot, 'assets', 'brand', 'README.md'), '# Signal Grid v1.0\n')
  await write(schemaPath, '{"title":"fixture schema"}\n')
  await write(join(repositoryRoot, 'app', 'package.json'), JSON.stringify({
    name: 'metrora-desktop',
    version: '0.9.19',
    homepage: 'https://metrora.eu',
    build: { appId: 'eu.metrora.desktop', productName: 'Metrora' },
  }))
  await write(join(repositoryRoot, 'app', 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/electron': { version: '43.1.0' },
      'node_modules/electron-builder': { version: '26.15.3' },
    },
  }))

  await write(join(bundleDirectory, 'Metrora.exe'), 'desktop-binary-fixture')
  await write(join(bundleDirectory, 'resources', 'app.asar'), 'renderer-fixture')
  await write(join(bundleDirectory, 'resources', 'cli', 'dist', 'main.js'), 'cli-fixture')

  return { root, repositoryRoot, bundleDirectory, schemaPath }
}

function metadataOptions(fx, builtAt = '2026-08-02T10:00:00.000Z') {
  return {
    repositoryRoot: fx.repositoryRoot,
    bundleDirectory: fx.bundleDirectory,
    schemaPath: fx.schemaPath,
    sourceCommit,
    sourceTree,
    sourceDateEpoch: '1785664800',
    distribution: 'unsigned-development-artifact',
    inputFiles,
    attestation: {
      provider: 'test',
      workflow: 'fixture',
      runId: '1',
      runAttempt: '1',
      ref: 'refs/heads/test',
      builtAt,
      runnerOs: 'test',
      runnerImage: 'fixture',
    },
  }
}

test('writes and independently verifies a complete candidate', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))

  const created = await writeReleaseMetadata(metadataOptions(fx))
  const verified = await verifyReleaseCandidate(fx.bundleDirectory, { expectedCommit: sourceCommit })

  assert.equal(created.manifest.payload.fileCount, 3)
  assert.equal(verified.fileCount, 3)
  assert.equal(verified.sourceCommit, sourceCommit)
  assert.equal(created.manifest.reproducibility.byteForByteArchiveProven, false)
})

test('manifest and payload inventory remain deterministic when only run attestation changes', async t => {
  const first = await fixture()
  const second = await fixture()
  t.after(() => Promise.all([
    rm(first.root, { recursive: true, force: true }),
    rm(second.root, { recursive: true, force: true }),
  ]))

  await writeReleaseMetadata(metadataOptions(first, '2026-08-02T10:00:00.000Z'))
  await writeReleaseMetadata(metadataOptions(second, '2026-08-02T11:00:00.000Z'))

  assert.equal(
    await readFile(join(first.bundleDirectory, 'RELEASE_MANIFEST.json'), 'utf8'),
    await readFile(join(second.bundleDirectory, 'RELEASE_MANIFEST.json'), 'utf8'),
  )
  assert.equal(
    await readFile(join(first.bundleDirectory, 'PAYLOAD_MANIFEST.jsonl'), 'utf8'),
    await readFile(join(second.bundleDirectory, 'PAYLOAD_MANIFEST.jsonl'), 'utf8'),
  )
  assert.notEqual(
    await sha256File(join(first.bundleDirectory, 'BUILD_ATTESTATION.json')),
    await sha256File(join(second.bundleDirectory, 'BUILD_ATTESTATION.json')),
  )
})

test('rejects payload tampering', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))

  await writeReleaseMetadata(metadataOptions(fx))
  await writeFile(join(fx.bundleDirectory, 'Metrora.exe'), 'tampered')

  await assert.rejects(
    verifyReleaseCandidate(fx.bundleDirectory),
    /payload verification failed/,
  )
})

test('rejects unlisted payload files', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))

  await writeReleaseMetadata(metadataOptions(fx))
  await writeFile(join(fx.bundleDirectory, 'unexpected.txt'), 'not inventoried')

  await assert.rejects(
    verifyReleaseCandidate(fx.bundleDirectory),
    /missing or unlisted payload files/,
  )
})

test('rejects metadata tampering', async t => {
  const fx = await fixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))

  await writeReleaseMetadata(metadataOptions(fx))
  await writeFile(join(fx.bundleDirectory, 'BUILD_ATTESTATION.json'), '{}\n')

  await assert.rejects(
    verifyReleaseCandidate(fx.bundleDirectory),
    /build attestation kind or version|metadata checksum mismatch/,
  )
})
