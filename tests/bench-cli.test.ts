import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { renderBenchHistory } from '../src/bench/cli.js'
import type { BenchEvaluationV1 } from '../src/bench/task-pack-run-v1.js'

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

  it('does not render an unavailable run as a zero-like pass rate', () => {
    const record = {
      runId: 'unavailable-run',
      model: { selected: 'qwen3:8b' },
      status: 'unavailable',
      aggregate: { planned: 6, passed: 0, failed: 0, unavailable: 6, cancelled: 0, score: { denominator: 0, value: null } },
      endedAt: '2026-08-27T10:00:00.000Z',
    } as BenchEvaluationV1
    const output = renderBenchHistory([record])
    expect(output).toContain('Core Compatibility unavailable')
    expect(output).toContain('no checks scored')
    expect(output).not.toContain('0/6 passed')
  })
})
