import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getMetroraCacheDir, getMetroraConfigDir } from './product-paths.js'

const roots: string[] = []

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'metrora-product-paths-'))
  roots.push(value)
  return value
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Metrora product path authority', () => {
  it('uses canonical Metrora roots for a fresh installation', () => {
    const home = root()
    expect(getMetroraConfigDir({}, home)).toBe(join(home, '.config', 'metrora'))
    expect(getMetroraCacheDir({}, home)).toBe(join(home, '.cache', 'metrora'))
  })

  it('adopts existing legacy roots in place instead of abandoning user state', () => {
    const home = root()
    const oldConfig = join(home, '.config', 'codeburn')
    const oldCache = join(home, '.cache', 'codeburn')
    mkdirSync(oldConfig, { recursive: true })
    mkdirSync(oldCache, { recursive: true })

    expect(getMetroraConfigDir({}, home)).toBe(oldConfig)
    expect(getMetroraCacheDir({}, home)).toBe(oldCache)
  })

  it('prefers canonical roots when both canonical and legacy data exist', () => {
    const home = root()
    const canonicalConfig = join(home, '.config', 'metrora')
    const canonicalCache = join(home, '.cache', 'metrora')
    mkdirSync(join(home, '.config', 'codeburn'), { recursive: true })
    mkdirSync(join(home, '.cache', 'codeburn'), { recursive: true })
    mkdirSync(canonicalConfig, { recursive: true })
    mkdirSync(canonicalCache, { recursive: true })

    expect(getMetroraConfigDir({}, home)).toBe(canonicalConfig)
    expect(getMetroraCacheDir({}, home)).toBe(canonicalCache)
  })

  it('honors Metrora overrides before temporary compatibility aliases', () => {
    const home = root()
    expect(getMetroraConfigDir({
      METRORA_CONFIG_DIR: '/canonical-config',
      QOVRION_CONFIG_DIR: '/qovrion-config',
      CODEBURN_CONFIG_DIR: '/legacy-config',
    }, home)).toBe('/canonical-config')
    expect(getMetroraCacheDir({
      METRORA_CACHE_DIR: '/canonical-cache',
      QOVRION_CACHE_DIR: '/qovrion-cache',
      CODEBURN_CACHE_DIR: '/legacy-cache',
    }, home)).toBe('/canonical-cache')
  })

  it('uses XDG bases without reintroducing a legacy product name', () => {
    const home = root()
    expect(getMetroraConfigDir({ XDG_CONFIG_HOME: '/xdg/config' }, home)).toBe('/xdg/config/metrora')
    expect(getMetroraCacheDir({ XDG_CACHE_HOME: '/xdg/cache' }, home)).toBe('/xdg/cache/metrora')
  })
})
