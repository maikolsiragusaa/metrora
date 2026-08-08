import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Metrora CLI package identity', () => {
  it('publishes the canonical command and both temporary compatibility aliases', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.name).toBe('metrora')
    expect(pkg.bin.metrora).toBe('dist/cli.js')
    expect(pkg.bin.metrora).toBe(pkg.bin.metrora)
    expect(pkg.bin.metrora).toBe(pkg.bin.metrora)
  })
})
