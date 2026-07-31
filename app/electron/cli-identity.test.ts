// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveTarget } from './cli'

const saved = { ...process.env }
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qovrion-cli-identity-'))
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, saved)
  delete process.env.QOVRION_BIN
  delete process.env.CODEBURN_BIN
  delete process.env.QOVRION_BUNDLED_CLI
  delete process.env.CODEBURN_BUNDLED_CLI
  delete process.env.VITE_DEV_SERVER_URL
  process.env.QOVRION_PATH_DIRS = ''
  process.env.QOVRION_CLI_PATH_FILE = join(dir, 'none')
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

describe('Qovrion CLI resolver wiring', () => {
  it('prefers QOVRION_BIN over CODEBURN_BIN', () => {
    const canonical = file('qovrion')
    const legacy = file('codeburn')
    process.env.QOVRION_BIN = canonical
    process.env.CODEBURN_BIN = legacy
    expect(resolveTarget()).toEqual({ kind: 'external', bin: canonical })
  })

  it('retains CODEBURN_BIN as a fallback', () => {
    const legacy = file('codeburn')
    process.env.CODEBURN_BIN = legacy
    expect(resolveTarget()).toEqual({ kind: 'external', bin: legacy })
  })

  it('prefers the canonical bundled entry over the legacy bundled entry', () => {
    const canonical = file('qovrion-bundled.js')
    const legacy = file('codeburn-bundled.js')
    process.env.QOVRION_BUNDLED_CLI = canonical
    process.env.CODEBURN_BUNDLED_CLI = legacy
    expect(resolveTarget()).toEqual({ kind: 'bundled', entry: canonical })
  })
})
