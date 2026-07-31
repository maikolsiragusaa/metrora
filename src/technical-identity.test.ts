import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Qovrion CLI package identity', () => {
  it('publishes canonical and legacy commands from the same entry point', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.name).toBe('qovrion')
    expect(pkg.bin.qovrion).toBe('dist/cli.js')
    expect(pkg.bin.codeburn).toBe(pkg.bin.qovrion)
  })
})
