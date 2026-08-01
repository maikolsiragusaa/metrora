// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cliExecutableNames, cliPathFiles, compatEnv, readPersistedCliPath } from './identity'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'metrora-identity-'))
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
  it('gives Metrora precedence over Qovrion and CodeBurn, including empty values', () => {
    expect(compatEnv({ METRORA_BIN: '/new', QOVRION_BIN: '/old-1', CODEBURN_BIN: '/old-2' }, 'METRORA_BIN', 'QOVRION_BIN', 'CODEBURN_BIN')).toBe('/new')
    expect(compatEnv({ METRORA_PATH_DIRS: '', QOVRION_PATH_DIRS: '/old' }, 'METRORA_PATH_DIRS', 'QOVRION_PATH_DIRS')).toBe('')
    expect(compatEnv({ QOVRION_BIN: '/old-1', CODEBURN_BIN: '/old-2' }, 'METRORA_BIN', 'QOVRION_BIN', 'CODEBURN_BIN')).toBe('/old-1')
    expect(compatEnv({ CODEBURN_BIN: '/old-2' }, 'METRORA_BIN', 'QOVRION_BIN', 'CODEBURN_BIN')).toBe('/old-2')
  })

  it('searches Metrora, Qovrion and CodeBurn in that order', () => {
    expect(cliExecutableNames('linux')).toEqual(['metrora', 'qovrion', 'codeburn'])
    expect(cliExecutableNames('win32').slice(0, 6)).toEqual([
      'metrora.cmd', 'metrora.exe', 'metrora',
      'qovrion.cmd', 'qovrion.exe', 'qovrion',
    ])
    expect(cliExecutableNames('win32')).toContain('codeburn.cmd')
  })

  it('uses the Metrora pointer and retains Qovrion then CodeBurn fallbacks', () => {
    const files = cliPathFiles({}, dir, 'linux')
    expect(files.canonical).toBe(join(dir, '.config', 'Metrora', 'metrora-cli-path.v1'))
    expect(files.legacy).toEqual([
      join(dir, '.config', 'Qovrion', 'qovrion-cli-path.v1'),
      join(dir, '.config', 'CodeBurn', 'codeburn-cli-path.v1'),
    ])
  })

  it('adopts a valid Qovrion pointer without deleting it', () => {
    const bin = executable('qovrion')
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.legacy[0]!, bin)

    const first = readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: value => value === bin })
    expect(first).toEqual({ value: bin, source: 'qovrion', migrated: true })
    expect(readFileSync(files.legacy[0]!, 'utf8')).toBe(bin)
    expect(readFileSync(files.canonical, 'utf8').trim()).toBe(bin)

    const second = readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: value => value === bin })
    expect(second).toEqual({ value: bin, source: 'canonical', migrated: false })
  })

  it('falls through an unusable Qovrion pointer to CodeBurn', () => {
    const bin = executable('codeburn')
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.legacy[0]!, '/invalid')
    writePointer(files.legacy[1]!, bin)
    expect(readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: value => value === bin }))
      .toEqual({ value: bin, source: 'codeburn', migrated: true })
  })

  it('never overwrites an existing canonical pointer', () => {
    const canonicalBin = executable('canonical')
    const legacyBin = executable('legacy')
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.canonical, canonicalBin)
    writePointer(files.legacy[0]!, legacyBin)

    expect(readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: () => true }))
      .toEqual({ value: canonicalBin, source: 'canonical', migrated: false })
    expect(readFileSync(files.legacy[0]!, 'utf8')).toBe(legacyBin)
  })

  it('treats an explicit Metrora pointer as authoritative', () => {
    const legacyBin = executable('legacy')
    const legacyFile = join(dir, 'legacy-pointer')
    writePointer(legacyFile, legacyBin)
    const canonicalFile = join(dir, 'missing-canonical')
    const env = { METRORA_CLI_PATH_FILE: canonicalFile, QOVRION_CLI_PATH_FILE: legacyFile }

    expect(readPersistedCliPath({ env, home: dir, platformName: 'linux', isUsable: () => true })).toBeNull()
    expect(existsSync(legacyFile)).toBe(true)
  })
})
