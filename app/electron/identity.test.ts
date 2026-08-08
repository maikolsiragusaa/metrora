// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  cliExecutableNames,
  cliPathFiles,
  compatEnv,
  LEGACY_CLI_NAME,
  LEGACY_CLI_PATH_FILENAME,
  LEGACY_CLI_PRODUCT_DIR,
  LEGACY_COMPAT_ENV,
  METRORA_ENV,
  readPersistedCliPath,
} from './identity'

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
  it('gives Metrora precedence over compatibility values, including empty values', () => {
    expect(compatEnv({ METRORA_BIN: '/new', [LEGACY_COMPAT_ENV.bin]: '/old-2' }, 'METRORA_BIN', LEGACY_COMPAT_ENV.bin)).toBe('/new')
    expect(compatEnv({ [METRORA_ENV.pathDirs]: '' }, METRORA_ENV.pathDirs, LEGACY_COMPAT_ENV.pathDirs)).toBe('')
    expect(compatEnv({ [LEGACY_COMPAT_ENV.bin]: '/old-2' }, METRORA_ENV.bin, LEGACY_COMPAT_ENV.bin)).toBe('/old-2')
  })

  it('searches Metrora before the compatibility executable', () => {
    expect(cliExecutableNames('linux')).toEqual(['metrora', LEGACY_CLI_NAME])
    expect(cliExecutableNames('win32')).toEqual([
      'metrora.cmd', 'metrora.exe', 'metrora',
      `${LEGACY_CLI_NAME}.cmd`, `${LEGACY_CLI_NAME}.exe`, LEGACY_CLI_NAME,
    ])
  })

  it('uses the Metrora pointer and retains one compatibility fallback', () => {
    const files = cliPathFiles({}, dir, 'linux')
    expect(files.canonical).toBe(join(dir, '.config', 'Metrora', 'metrora-cli-path.v1'))
    expect(files.legacy).toEqual([
      join(dir, '.config', LEGACY_CLI_PRODUCT_DIR, LEGACY_CLI_PATH_FILENAME),
    ])
  })

  it('adopts a valid compatibility pointer without deleting it', () => {
    const bin = executable('metrora')
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.legacy[0]!, bin)

    const first = readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: value => value === bin })
    expect(first).toEqual({ value: bin, source: 'legacy', migrated: true })
    expect(readFileSync(files.legacy[0]!, 'utf8')).toBe(bin)
    expect(readFileSync(files.canonical, 'utf8').trim()).toBe(bin)

    const second = readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: value => value === bin })
    expect(second).toEqual({ value: bin, source: 'canonical', migrated: false })
  })

  it('ignores an unusable compatibility pointer', () => {
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.legacy[0]!, '/invalid')
    expect(readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: () => false })).toBeNull()
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
    const env = { METRORA_CLI_PATH_FILE: canonicalFile }

    expect(readPersistedCliPath({ env, home: dir, platformName: 'linux', isUsable: () => true })).toBeNull()
    expect(existsSync(legacyFile)).toBe(true)
  })
})
