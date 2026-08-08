import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  getMetroraCacheDir,
  getMetroraConfigDir,
  getMetroraLegacyCacheDirs,
  LEGACY_CACHE_DIR_ENV,
  LEGACY_CONFIG_DIR_ENV,
  LEGACY_PRODUCT_ROOT,
} from './product-paths.js'

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

  it('keeps the runtime canonical while exposing an existing legacy root as migration input', () => {
    const home = root()
    const oldConfig = join(home, '.config', LEGACY_PRODUCT_ROOT)
    const oldCache = join(home, '.cache', LEGACY_PRODUCT_ROOT)
    mkdirSync(oldConfig, { recursive: true })
    mkdirSync(oldCache, { recursive: true })

    expect(getMetroraConfigDir({}, home)).toBe(oldConfig)
    expect(getMetroraCacheDir({}, home)).toBe(join(home, '.cache', 'metrora'))
    expect(getMetroraLegacyCacheDirs({}, home)).toContain(oldCache)
  })

  it('prefers canonical roots when both canonical and legacy data exist', () => {
    const home = root()
    const canonicalConfig = join(home, '.config', 'metrora')
    const canonicalCache = join(home, '.cache', 'metrora')
    mkdirSync(join(home, '.config', LEGACY_PRODUCT_ROOT), { recursive: true })
    mkdirSync(join(home, '.cache', LEGACY_PRODUCT_ROOT), { recursive: true })
    mkdirSync(canonicalConfig, { recursive: true })
    mkdirSync(canonicalCache, { recursive: true })

    expect(getMetroraConfigDir({}, home)).toBe(canonicalConfig)
    expect(getMetroraCacheDir({}, home)).toBe(canonicalCache)
  })

  it('honors Metrora overrides before compatibility aliases', () => {
    const home = root()
    expect(getMetroraConfigDir({
      METRORA_CONFIG_DIR: '/canonical-config',
      [LEGACY_CONFIG_DIR_ENV]: '/legacy-config',
    }, home)).toBe('/canonical-config')
    expect(getMetroraCacheDir({
      METRORA_CACHE_DIR: '/canonical-cache',
      [LEGACY_CACHE_DIR_ENV]: '/legacy-cache',
    }, home)).toBe('/canonical-cache')
    expect(getMetroraLegacyCacheDirs({
      METRORA_CACHE_DIR: '/canonical-cache',
      [LEGACY_CACHE_DIR_ENV]: '/legacy-cache',
    }, home)).toContain('/legacy-cache')
  })

  it('uses XDG bases without reintroducing a legacy product name', () => {
    const home = root()
    expect(getMetroraConfigDir({ XDG_CONFIG_HOME: join('\\xdg', 'config') }, home)).toBe(join('\\xdg', 'config', 'metrora'))
    expect(getMetroraCacheDir({ XDG_CACHE_HOME: join('\\xdg', 'cache') }, home)).toBe(join('\\xdg', 'cache', 'metrora'))
  })
})
