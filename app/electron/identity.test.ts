// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cliExecutableNames, cliPathFiles, compatEnv, readPersistedCliPath } from './identity'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qovrion-identity-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function executable(name: string): string {
  const file = join(dir, name)
  writeFileSync(file, '#!/usr/bin/env node\n', { mode: 0o755 })
  return file
}

function writePointer(file: string, value: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, value)
}

describe('technical identity compatibility', () => {
  it('gives QOVRION values precedence, including deliberate empty values', () => {
    expect(compatEnv({ QOVRION_BIN: '/new', CODEBURN_BIN: '/old' }, 'QOVRION_BIN', 'CODEBURN_BIN')).toBe('/new')
    expect(compatEnv({ QOVRION_PATH_DIRS: '', CODEBURN_PATH_DIRS: '/old' }, 'QOVRION_PATH_DIRS', 'CODEBURN_PATH_DIRS')).toBe('')
    expect(compatEnv({ CODEBURN_BIN: '/old' }, 'QOVRION_BIN', 'CODEBURN_BIN')).toBe('/old')
  })

  it('searches the Qovrion executable before the legacy alias on every platform', () => {
    expect(cliExecutableNames('linux')).toEqual(['qovrion', 'codeburn'])
    expect(cliExecutableNames('win32').slice(0, 3)).toEqual(['qovrion.cmd', 'qovrion.exe', 'qovrion'])
    expect(cliExecutableNames('win32')).toContain('codeburn.cmd')
  })

  it('uses canonical persisted locations while retaining the legacy fallback', () => {
    const files = cliPathFiles({}, dir, 'linux')
    expect(files.canonical).toBe(join(dir, '.config', 'Qovrion', 'qovrion-cli-path.v1'))
    expect(files.legacy).toBe(join(dir, '.config', 'CodeBurn', 'codeburn-cli-path.v1'))
  })

  it('migrates a valid legacy pointer once without deleting the legacy file', () => {
    const bin = executable('qovrion')
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.legacy!, bin)

    const first = readPersistedCliPath({
      env: {},
      home: dir,
      platformName: 'linux',
      isUsable: value => value === bin,
    })
    expect(first).toEqual({ value: bin, source: 'legacy', migrated: true })
    expect(readFileSync(files.legacy!, 'utf8')).toBe(bin)
    expect(readFileSync(files.canonical, 'utf8').trim()).toBe(bin)

    const second = readPersistedCliPath({
      env: {},
      home: dir,
      platformName: 'linux',
      isUsable: value => value === bin,
    })
    expect(second).toEqual({ value: bin, source: 'canonical', migrated: false })
  })

  it('never overwrites a canonical pointer when both generations exist', () => {
    const canonicalBin = executable('canonical')
    const legacyBin = executable('legacy')
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.canonical, canonicalBin)
    writePointer(files.legacy!, legacyBin)

    expect(readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: () => true }))
      .toEqual({ value: canonicalBin, source: 'canonical', migrated: false })
    expect(readFileSync(files.legacy!, 'utf8')).toBe(legacyBin)
  })

  it('falls back to legacy without replacing an existing invalid canonical file', () => {
    const legacyBin = executable('legacy')
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.canonical, '/invalid')
    writePointer(files.legacy!, legacyBin)

    expect(readPersistedCliPath({
      env: {},
      home: dir,
      platformName: 'linux',
      isUsable: value => value === legacyBin,
    })).toEqual({ value: legacyBin, source: 'legacy', migrated: false })
    expect(readFileSync(files.canonical, 'utf8')).toBe('/invalid')
  })

  it('treats an explicit QOVRION pointer as authoritative', () => {
    const legacyBin = executable('legacy')
    const legacyFile = join(dir, 'legacy-pointer')
    writePointer(legacyFile, legacyBin)
    const canonicalFile = join(dir, 'missing-canonical')
    const env = {
      QOVRION_CLI_PATH_FILE: canonicalFile,
      CODEBURN_CLI_PATH_FILE: legacyFile,
    }

    expect(readPersistedCliPath({ env, home: dir, platformName: 'linux', isUsable: () => true })).toBeNull()
    expect(existsSync(legacyFile)).toBe(true)
  })
})
