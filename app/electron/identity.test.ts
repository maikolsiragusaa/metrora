// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  cliExecutableNames,
  cliPathFiles,
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

describe('canonical Metrora CLI identity', () => {
  it('searches only the Metrora executable', () => {
    expect(cliExecutableNames('linux')).toEqual(['metrora'])
    expect(cliExecutableNames('win32')).toEqual(['metrora.cmd', 'metrora.exe', 'metrora'])
  })

  it('uses the canonical Metrora pointer path', () => {
    const files = cliPathFiles({}, dir, 'linux')
    expect(files).toEqual({
      canonical: join(dir, '.config', 'Metrora', 'metrora-cli-path.v1'),
    })
  })

  it('reads a usable canonical pointer without rewriting it', () => {
    const bin = executable('metrora')
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.canonical, bin)

    expect(readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: value => value === bin }))
      .toBe(bin)
    expect(readFileSync(files.canonical, 'utf8')).toBe(bin)
  })

  it('ignores an unusable canonical pointer', () => {
    const files = cliPathFiles({}, dir, 'linux')
    writePointer(files.canonical, '/invalid')
    expect(readPersistedCliPath({ env: {}, home: dir, platformName: 'linux', isUsable: () => false })).toBeNull()
  })

  it('treats an explicit Metrora pointer as authoritative', () => {
    const bin = executable('metrora')
    const pointer = join(dir, 'explicit-pointer')
    writePointer(pointer, bin)
    const files = cliPathFiles({ [METRORA_ENV.cliPathFile]: pointer }, dir, 'linux')

    expect(files).toEqual({ canonical: pointer })
    expect(readPersistedCliPath({
      env: { [METRORA_ENV.cliPathFile]: pointer },
      home: dir,
      platformName: 'linux',
      isUsable: value => value === bin,
    })).toBe(bin)
    expect(existsSync(pointer)).toBe(true)
  })
})
