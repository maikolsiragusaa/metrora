import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Metrora CLI package identity', () => {
  it('publishes only the canonical Metrora command', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.name).toBe('metrora')
    expect(pkg.bin).toEqual({ metrora: 'dist/cli.js' })
  })
})
