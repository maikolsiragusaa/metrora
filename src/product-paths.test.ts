import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
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

  it('does not adopt unrelated existing roots', () => {
    const home = root()
    const previousConfig = join(home, '.config', 'previous-product')
    const previousCache = join(home, '.cache', 'previous-product')
    expect(getMetroraConfigDir({}, home)).not.toBe(previousConfig)
    expect(getMetroraCacheDir({}, home)).not.toBe(previousCache)
  })

  it('honors explicit canonical Metrora overrides', () => {
    const home = root()
    expect(getMetroraConfigDir({ METRORA_CONFIG_DIR: '/canonical-config' }, home)).toBe('/canonical-config')
    expect(getMetroraCacheDir({ METRORA_CACHE_DIR: '/canonical-cache' }, home)).toBe('/canonical-cache')
  })

  it('uses XDG bases for canonical roots', () => {
    const home = root()
    expect(getMetroraConfigDir({ XDG_CONFIG_HOME: join('xdg', 'config') }, home)).toBe(join('xdg', 'config', 'metrora'))
    expect(getMetroraCacheDir({ XDG_CACHE_HOME: join('xdg', 'cache') }, home)).toBe(join('xdg', 'cache', 'metrora'))
  })
})
