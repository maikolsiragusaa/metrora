// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveTarget } from './cli'

const saved = { ...process.env }
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'metrora-cli-identity-'))
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, saved)
  for (const key of ['METRORA_BIN', 'QOVRION_BIN', 'CODEBURN_BIN', 'METRORA_BUNDLED_CLI', 'QOVRION_BUNDLED_CLI', 'CODEBURN_BUNDLED_CLI', 'VITE_DEV_SERVER_URL']) delete process.env[key]
  process.env.METRORA_PATH_DIRS = ''
  process.env.METRORA_CLI_PATH_FILE = join(dir, 'none')
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
  it('prefers METRORA_BIN over both compatibility variables', () => {
    const canonical = file('metrora')
    process.env.METRORA_BIN = canonical
    process.env.QOVRION_BIN = file('qovrion')
    process.env.CODEBURN_BIN = file('codeburn')
    expect(resolveTarget()).toEqual({ kind: 'external', bin: canonical })
  })

  it('prefers QOVRION_BIN over CODEBURN_BIN when Metrora is absent', () => {
    const qovrion = file('qovrion')
    process.env.QOVRION_BIN = qovrion
    process.env.CODEBURN_BIN = file('codeburn')
    expect(resolveTarget()).toEqual({ kind: 'external', bin: qovrion })
  })

  it('retains CODEBURN_BIN as the final fallback', () => {
    const legacy = file('codeburn')
    process.env.CODEBURN_BIN = legacy
    expect(resolveTarget()).toEqual({ kind: 'external', bin: legacy })
  })

  it('applies the same precedence to bundled entries', () => {
    const canonical = file('metrora-bundled.js')
    process.env.METRORA_BUNDLED_CLI = canonical
    process.env.QOVRION_BUNDLED_CLI = file('qovrion-bundled.js')
    process.env.CODEBURN_BUNDLED_CLI = file('codeburn-bundled.js')
    expect(resolveTarget()).toEqual({ kind: 'bundled', entry: canonical })
  })
})
