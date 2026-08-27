import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('metrora bench local CLI', () => {
  it('exposes the user-invokable local BenchRunV1 entrypoint', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'bench', 'local', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        METRORA_TZ: 'UTC',
      },
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: metrora bench local [options]')
    expect(result.stdout).toContain('--model <model>')
    expect(result.stdout).toContain('--output <path>')
    expect(result.stdout).toContain('--timeout-ms <ms>')
  })

  it('exposes bounded local model discovery without requiring a model name', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'bench', 'models', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        METRORA_TZ: 'UTC',
      },
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: metrora bench models [options]')
    expect(result.stdout).toContain('--format <format>')
  })
})
