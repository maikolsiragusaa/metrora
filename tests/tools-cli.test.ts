import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OPENCODE_METRORA_TOOL_SOURCES } from '../app/electron/opencode/tool'
import { OPENCODE_METRORA_TOOL_IDS, OPENCODE_METRORA_TOOL_MAP } from '../app/electron/opencode/types'
import { isMetroraToolName } from '../src/tools/contract.js'
import { registerMetroraToolCommands, runMetroraToolsCall } from '../src/tools/cli.js'
import { createMetroraToolRegistry } from '../src/tools/registry.js'
import type { MetroraToolDataSource, MetroraToolRegistry } from '../src/tools/types.js'

const temporaryDirectories: string[] = []
const originalBridgeSpec = process.env.METRORA_TOOL_BRIDGE_SPEC

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  if (originalBridgeSpec === undefined) delete process.env.METRORA_TOOL_BRIDGE_SPEC
  else process.env.METRORA_TOOL_BRIDGE_SPEC = originalBridgeSpec
})

function importOpenCodeToolSource(source: string): Promise<{ default: { execute: (args?: unknown, context?: unknown) => Promise<string> } }> {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) as Promise<{ default: { execute: (args?: unknown, context?: unknown) => Promise<string> } }>
}

function canonicalBridgeEntry(directory: string): void {
  const entry = join(directory, 'canonical-bridge.mjs')
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const tsxApiUrl = pathToFileURL(join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'esm', 'api', 'index.mjs')).href
  const cliUrl = pathToFileURL(join(repositoryRoot, 'src', 'tools', 'cli.ts')).href
  const registryUrl = pathToFileURL(join(repositoryRoot, 'src', 'tools', 'registry.ts')).href
  writeFileSync(entry, [
    `const { tsImport } = await import(${JSON.stringify(tsxApiUrl)})`,
    `const { runMetroraToolsCall } = await tsImport(${JSON.stringify(cliUrl)}, { parentURL: import.meta.url })`,
    `const { createMetroraToolRegistry } = await tsImport(${JSON.stringify(registryUrl)}, { parentURL: import.meta.url })`,
    'const scope = { period: "all", range: null, provider: "all", projectId: "all", projectName: "All projects", model: null }',
    'const source = {',
    '  getOverview: async () => ({ current: { label: "All", cost: 12.5, calls: 3, sessions: 2, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, pricingCoverage: 1, providers: { Codex: 12.5 }, providerDetails: [{ id: "codex", label: "Codex", cost: 12.5 }], topModels: [{ name: "fixture-model", cost: 12.5, calls: 3 }], topProjects: [{ name: "fixture-project", cost: 12.5, sessions: 2 }], topSessions: [{ project: "fixture-project", cost: 12.5, calls: 3, date: "2026-09-05" }] }, history: { daily: [] }}),',
    '  getModels: async () => [{ provider: "codex", providerDisplayName: "Codex", model: "fixture-model", inputTokens: 100, outputTokens: 50, reasoningTokens: 0, additiveReasoningTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, totalTokens: 150, costUSD: 12.5, calls: 3, pricing: { state: "priced" } }],',
    '  getQuota: async () => [],',
    '  getBenchEvidence: async () => ({ state: "UNAVAILABLE" }),',
    '}',
    'const runtime = createMetroraToolRegistry(source, scope)',
    'const argv = process.argv.slice(2)',
    'const exitCode = await runMetroraToolsCall(argv[2], { argsJson: argv[4] ?? "{}", period: "all", provider: "all", projectId: "all" }, { createRuntime: async () => runtime, loadPricing: async () => {} })',
    'process.exitCode = exitCode',
    '',
  ].join('\n'))
  process.env.METRORA_TOOL_BRIDGE_SPEC = JSON.stringify({
    command: [process.execPath, entry, 'tools', 'call'],
    environment: {},
  })
}

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
  it('keeps every OpenCode transport ID mapped to one valid canonical registry name', () => {
    const ids = [...OPENCODE_METRORA_TOOL_IDS]
    const canonicalNames = [
      'get_spend_snapshot',
      'get_model_efficiency',
      'get_overview_snapshot',
      'get_project_drivers',
      'get_session_highlights',
      'get_coverage_report',
      'get_bench_evidence',
    ] as const

    expect(Object.keys(OPENCODE_METRORA_TOOL_MAP)).toEqual(ids)
    expect(Object.values(OPENCODE_METRORA_TOOL_MAP)).toEqual([...canonicalNames])
    for (const toolId of ids) expect(isMetroraToolName(OPENCODE_METRORA_TOOL_MAP[toolId])).toBe(true)
  })

  it('routes spend and model OpenCode tools through the bridge, canonical CLI, and registry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'metrora-opencode-canonical-bridge-'))
    temporaryDirectories.push(directory)
    canonicalBridgeEntry(directory)

    const spend = await importOpenCodeToolSource(OPENCODE_METRORA_TOOL_SOURCES.metrora_get_spend_snapshot)
    const spendOutput = await spend.default.execute({ filters: { period: 'today' } })
    expect(spendOutput).not.toBe('Metrora tool unavailable.')
    expect(JSON.parse(spendOutput)).toMatchObject({
      intent: 'spend-change',
      scope: { period: 'today', provider: 'all', projectId: 'all' },
      spend: { measuredCostUSD: 12.5 },
    })

    const models = await importOpenCodeToolSource(OPENCODE_METRORA_TOOL_SOURCES.metrora_get_model_efficiency)
    const modelsOutput = await models.default.execute({ filters: { model: 'fixture-model' } })
    expect(modelsOutput).not.toBe('Metrora tool unavailable.')
    expect(JSON.parse(modelsOutput)).toMatchObject({
      intent: 'model-efficiency',
      modelEfficiency: { rows: expect.arrayContaining([expect.objectContaining({ model: 'fixture-model', costUSD: 12.5 })]) },
    })
  })

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
