import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'

import { registerMetroraToolCommands, runMetroraToolsCall } from '../src/tools/cli.js'
import { createMetroraToolRegistry } from '../src/tools/registry.js'
import type { MetroraToolDataSource, MetroraToolRegistry } from '../src/tools/types.js'

const scope = {
  period: 'all' as const,
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

function canonicalRegistry(): MetroraToolRegistry {
  const source: MetroraToolDataSource = {
    getOverview: vi.fn(async () => ({ current: undefined, history: { daily: [] } })),
    getModels: vi.fn(async () => []),
    getQuota: vi.fn(async () => []),
    getBenchEvidence: vi.fn(async () => ({ state: 'UNAVAILABLE' as const })),
  }
  return createMetroraToolRegistry(source, scope)
}

const options = {
  argsJson: '{}',
  period: 'all',
  provider: 'all',
  projectId: 'all',
}

async function run(
  toolName: string,
  overrides: Partial<typeof options> = {},
  runtime = canonicalRegistry(),
) {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = await runMetroraToolsCall(toolName, { ...options, ...overrides }, {
    createRuntime: async () => runtime,
    loadPricing: async () => {},
    writeStdout: value => stdout.push(value),
    writeStderr: value => stderr.push(value),
  })
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') }
}

describe('canonical Metrora Tools CLI adapter', () => {
  it('returns only bounded canonical result content and forwards the startup scope', async () => {
    const runtime = canonicalRegistry()
    const createRuntime = vi.fn(async (startup) => {
      expect(startup).toEqual({ period: 'week', provider: 'claude', projectId: 'all' })
      return runtime
    })
    const stdout: string[] = []
    const stderr: string[] = []

    const exitCode = await runMetroraToolsCall('get_spend_snapshot', {
      ...options,
      argsJson: '{"period":"today","model":"gpt-4o"}',
      period: 'week',
      provider: 'claude',
    }, {
      createRuntime,
      loadPricing: async () => {},
      writeStdout: value => stdout.push(value),
      writeStderr: value => stderr.push(value),
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    expect(JSON.parse(stdout[0]!)).toMatchObject({ coverage: expect.any(Object), scope: expect.any(Object) })
    expect(createRuntime).toHaveBeenCalledOnce()
  })

  it.each([
    ['unknown tool', 'not_a_tool', '{}', 'unknown-tool'],
    ['malformed JSON', 'get_spend_snapshot', '{', 'invalid-arguments'],
    ['unsupported argument', 'get_project_drivers', '{"model":"not-allowed"}', 'additional-argument'],
    ['unsupported startup period', 'get_spend_snapshot', '{}', 'invalid-scope'],
  ])('fails closed for %s without writing result content', async (_label, toolName, argsJson, expectedCode) => {
    const result = await run(toolName, {
      argsJson,
      ...(expectedCode === 'invalid-scope' ? { period: 'yesterday' } : {}),
    })
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(`metrora tools call failed (${expectedCode}).\n`)
  })

  it('rejects non-canonical or privacy-unsafe output without leaking it to stderr', async () => {
    const unsafeRuntime = {
      ...canonicalRegistry(),
      execute: vi.fn(async () => ({ content: '{"prompt":"do not leak"}' })),
    } as unknown as MetroraToolRegistry
    const result = await run('get_spend_snapshot', {}, unsafeRuntime)
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('metrora tools call failed (invalid-output).\n')
    expect(result.stderr).not.toContain('do not leak')
  })

  it('registers only the explicit tools call command under tools', () => {
    const program = new Command()
    registerMetroraToolCommands(program)
    const tools = program.commands.find(command => command.name() === 'tools')
    expect(tools).toBeDefined()
    expect(tools?.commands.map(command => command.name())).toEqual(['call'])
    expect(tools?.commands[0]?.options.map(option => option.long)).toEqual([
      '--args-json',
      '--period',
      '--provider',
      '--project-id',
    ])
  })
})
