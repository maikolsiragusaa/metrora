import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { sha256Text, stableJson } from './windows-release-manifest-lib.mjs'
import {
  materializePhysicalCanonicalPayload,
  parsePhysicalCandidateInventory,
} from './windows-physical-candidate.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'metrora-physical-candidate-'))
  const candidate = join(root, 'candidate')
  const portable = join(candidate, 'portable')
  const output = join(root, 'canonical')
  await mkdir(join(portable, 'resources'), { recursive: true })
  const files = [
    ['Metrora.exe', 'binary-one'],
    ['resources/app.asar', 'binary-two'],
  ]
  const entries = []
  for (const [path, content] of files) {
    const destination = join(portable, path)
    await writeFile(destination, content)
    entries.push({ path, size: Buffer.byteLength(content), sha256: sha256Text(content) })
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const inventory = `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`
  await writeFile(join(candidate, 'CANONICAL_PRODUCT_PAYLOAD.jsonl'), inventory)
  return { root, candidate, output, entries, inventory }
}

test('parses a canonical sorted physical inventory', () => {
  const text = `${stableJson({ path: 'a.txt', size: 1, sha256: 'a'.repeat(64) }).trim()}\n`
  assert.deepEqual(parsePhysicalCandidateInventory(text), [
    { path: 'a.txt', size: 1, sha256: 'a'.repeat(64) },
  ])
})

test('rejects traversal and duplicate inventory entries', () => {
  const digest = 'a'.repeat(64)
  assert.throws(
    () => parsePhysicalCandidateInventory(`${JSON.stringify({ path: '../escape', size: 1, sha256: digest })}\n`),
    /invalid entry/,
  )
  const duplicate = JSON.stringify({ path: 'same', size: 1, sha256: digest })
  assert.throws(() => parsePhysicalCandidateInventory(`${duplicate}\n${duplicate}\n`), /duplicate path/)
})

test('materializes only canonical inventoried files', async () => {
  const current = await fixture()
  try {
    await writeFile(join(current.candidate, 'portable', 'README.txt'), 'portable helper')
    const result = await materializePhysicalCanonicalPayload({
      candidateDirectory: current.candidate,
      outputDirectory: current.output,
    })
    assert.equal(result.fileCount, current.entries.length)
    assert.equal(await readFile(join(current.output, 'Metrora.exe'), 'utf8'), 'binary-one')
    await assert.rejects(readFile(join(current.output, 'README.txt'), 'utf8'))
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('rejects a portable file that no longer matches inventory', async () => {
  const current = await fixture()
  try {
    await writeFile(join(current.candidate, 'portable', 'Metrora.exe'), 'mutated')
    await assert.rejects(
      materializePhysicalCanonicalPayload({
        candidateDirectory: current.candidate,
        outputDirectory: current.output,
      }),
      /does not match inventory/,
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('rejects an output inside the downloaded candidate', async () => {
  const current = await fixture()
  try {
    await assert.rejects(
      materializePhysicalCanonicalPayload({
        candidateDirectory: current.candidate,
        outputDirectory: join(current.candidate, 'derived'),
      }),
      /outside the candidate directory/,
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})
