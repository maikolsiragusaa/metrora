// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveTarget } from './cli'
import { LEGACY_COMPAT_ENV, METRORA_ENV } from './identity'

const saved = { ...process.env }
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'metrora-cli-identity-'))
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, saved)
  for (const key of [METRORA_ENV.bin, LEGACY_COMPAT_ENV.bin, METRORA_ENV.bundledCli, LEGACY_COMPAT_ENV.bundledCli, 'VITE_DEV_SERVER_URL']) delete process.env[key]
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
  it('prefers METRORA_BIN over both compatibility variables', () => {
    const canonical = file('metrora')
    process.env[METRORA_ENV.bin] = canonical
    process.env[LEGACY_COMPAT_ENV.bin] = file('legacy-cli')
    expect(resolveTarget()).toEqual({ kind: 'external', bin: canonical })
  })

  it('prefers the canonical bin over the compatibility bin when Metrora is present', () => {
    const metrora = file('metrora')
    process.env[METRORA_ENV.bin] = metrora
    process.env[LEGACY_COMPAT_ENV.bin] = file('legacy-cli')
    expect(resolveTarget()).toEqual({ kind: 'external', bin: metrora })
  })

  it('retains the compatibility bin as the final fallback', () => {
    const legacy = file('legacy-cli')
    process.env[LEGACY_COMPAT_ENV.bin] = legacy
    expect(resolveTarget()).toEqual({ kind: 'external', bin: legacy })
  })

  it('applies the same precedence to bundled entries', () => {
    const canonical = file('metrora-bundled.js')
    process.env[METRORA_ENV.bundledCli] = canonical
    process.env[LEGACY_COMPAT_ENV.bundledCli] = file('legacy-bundled.js')
    expect(resolveTarget()).toEqual({ kind: 'bundled', entry: canonical })
  })
})
