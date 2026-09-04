#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ASSETS, VERSION, sha256, stageOpenCode, verifyStageIdentity } from './stage-opencode.mjs'

function tempDirectory() {
  return mkdtempSync(join(tmpdir(), 'metrora-opencode-stage-'))
}

test('verified OpenCode staging identity requires both the pinned archive and binary digest', () => {
  const root = tempDirectory()
  try {
    const archive = join(root, 'opencode.zip')
    const binary = join(root, 'opencode.exe')
    writeFileSync(archive, 'trusted archive')
    writeFileSync(binary, 'trusted binary')
    const archiveDigest = sha256(archive)
    const binaryDigest = sha256(binary)

    assert.equal(verifyStageIdentity(binary, archive, archiveDigest, binaryDigest), true)
    writeFileSync(binary, 'tampered binary')
    assert.equal(verifyStageIdentity(binary, archive, archiveDigest, binaryDigest), false)
    writeFileSync(binary, 'trusted binary')
    writeFileSync(archive, 'tampered archive')
    assert.equal(verifyStageIdentity(binary, archive, archiveDigest, binaryDigest), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('same-version staged binary without its verified archive is rejected when download is disabled', async () => {
  const root = tempDirectory()
  const previous = process.env.METRORA_OPENCODE_SKIP_DOWNLOAD
  process.env.METRORA_OPENCODE_SKIP_DOWNLOAD = '1'
  try {
    const asset = ASSETS['win32-x64']
    const directory = join(root, 'build', 'opencode', VERSION, 'win32-x64')
    const binary = join(directory, asset.binary)
    mkdirSync(directory, { recursive: true })
    writeFileSync(binary, 'stale binary without archive')
    await assert.rejects(
      stageOpenCode({ appDir: root, platform: 'win32', arch: 'x64' }),
      /no verified archive; refusing stale reuse/u,
    )
  } finally {
    if (previous === undefined) delete process.env.METRORA_OPENCODE_SKIP_DOWNLOAD
    else process.env.METRORA_OPENCODE_SKIP_DOWNLOAD = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('same-version staged archive checksum mismatch is rejected before extraction', async () => {
  const root = tempDirectory()
  try {
    const asset = ASSETS['win32-x64']
    const directory = join(root, 'build', 'opencode', VERSION, 'win32-x64')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, asset.binary), 'stale binary')
    writeFileSync(join(directory, asset.file), 'tampered archive')
    await assert.rejects(
      stageOpenCode({ appDir: root, platform: 'win32', arch: 'x64' }),
      /staged archive identity mismatch; refusing reuse/u,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
