// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveTarget } from './cli'
import { METRORA_ENV } from './identity'

const saved = { ...process.env }
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'metrora-cli-identity-'))
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, saved)
  for (const key of [METRORA_ENV.bin, METRORA_ENV.bundledCli, 'VITE_DEV_SERVER_URL']) delete process.env[key]
  process.env[METRORA_ENV.pathDirs] = ''
  process.env[METRORA_ENV.cliPathFile] = join(dir, 'none')
})

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, saved)
  rmSync(dir, { recursive: true, force: true })
})

function file(name: string): string {
  const value = join(dir, name)
  writeFileSync(value, '#!/usr/bin/env node\n', { mode: 0o755 })
  chmodSync(value, 0o755)
  return value
}

describe('Metrora CLI resolver wiring', () => {
  it('uses the canonical external bin override', () => {
    const bin = file('metrora')
    process.env[METRORA_ENV.bin] = bin
    expect(resolveTarget()).toEqual({ kind: 'external', bin })
  })

  it('uses the canonical bundled entry', () => {
    const entry = file('metrora-bundled.js')
    process.env[METRORA_ENV.bundledCli] = entry
    expect(resolveTarget()).toEqual({ kind: 'bundled', entry })
  })
})
