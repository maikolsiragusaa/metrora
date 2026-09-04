import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { describe, expect, it } from 'vitest'
import { createMetroraToolRuntime } from '../src/mcp/runtime.js'

const TOOL_NAMES = [
  'get_spend_snapshot',
  'get_model_efficiency',
  'get_quota_snapshot',
  'get_overview_snapshot',
  'get_project_drivers',
  'get_session_highlights',
  'get_coverage_report',
  'get_bench_evidence',
] as const

const FORBIDDEN_TOOL_NAMES = [
  'act',
  'swarm',
  'approve_action',
  'execute_action',
  'propose_action',
  'run_core_compatibility',
  'run-core-compatibility',
  'run_bench',
  'launch_agent',
  'launch_swarm',
  'shell',
  'filesystem',
] as const

type WireResult = Awaited<ReturnType<Client['callTool']>>

function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(process.cwd(), 'src', 'cli.ts'), ...args],
    { cwd: process.cwd(), encoding: 'utf8' },
  )
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  }
}

function textContent(result: WireResult): string {
  const entries = result.content.filter((entry): entry is { type: 'text'; text: string } => entry.type === 'text')
  expect(entries).toHaveLength(1)
  return entries[0]!.text
}

async function withStdioClient<T>(work: (client: Client, stderr: () => string) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', join(process.cwd(), 'src', 'cli.ts'), 'mcp', 'serve'],
    cwd: process.cwd(),
    stderr: 'pipe',
  })
  const stderrChunks: string[] = []
  transport.stderr?.on('data', chunk => stderrChunks.push(String(chunk)))
  const client = new Client({ name: 'metrora-qa-client', version: '1.0.0' })
  try {
    await client.connect(transport)
    return await work(client, () => stderrChunks.join(''))
  } finally {
    await client.close().catch(async () => { await transport.close() })
  }
}

async function expectFailClosed(call: Promise<WireResult>, secret: string): Promise<void> {
  let result: WireResult | undefined
  let thrown: unknown
  try {
    result = await call
  } catch (error) {
    thrown = error
  }
  if (thrown !== undefined) {
    expect(String(thrown)).not.toContain(secret)
    return
  }
  expect(result?.isError).toBe(true)
  expect(JSON.stringify(result)).not.toContain(secret)
}

describe('MCP V1 interoperability contract', () => {
  it('reports truthful local stdio metadata and the canonical eight tool identities', () => {
    const result = runCli('mcp', 'info', '--json')
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const info = JSON.parse(result.stdout) as {
      transport: string
      localOnly: boolean
      readOnly: boolean
      command: { command: string; args: string[] }
      tools: string[]
    }
    expect(info).toMatchObject({
      transport: 'stdio',
      localOnly: true,
      readOnly: true,
      command: { command: 'metrora', args: ['mcp', 'serve'] },
      tools: [...TOOL_NAMES],
    })
  })

  it('rejects invalid startup period, provider, and Project scopes without leaking a stack or path', () => {
    const cases = [
      { args: ['mcp', 'serve', '--period', 'nope'], message: 'unsupported MCP period' },
      { args: ['mcp', 'serve', '--provider', 'openai'], message: 'unsupported MCP provider' },
      { args: ['mcp', 'serve', '--project-id', 'nope'], message: 'Project scope was not found' },
    ]
    for (const testCase of cases) {
      const result = runCli(...testCase.args)
      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain(testCase.message)
      expect(result.stderr).not.toMatch(/(?:Node\.js|\bat |src[\\/]mcp[\\/]|C:\\Users\\|\/Users\/|\/home\/)/iu)
    }
  }, 30_000)

  it('negotiates over real stdio, exposes only the canonical read-only tools, and closes cleanly', async () => {
    await withStdioClient(async (client, stderr) => {
      const listed = await client.listTools()
      expect(listed.tools.map(tool => tool.name)).toEqual(TOOL_NAMES)

      for (const tool of listed.tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true)
        expect(tool.annotations?.openWorldHint).toBe(false)
        expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
        expect(tool.description).not.toMatch(/ACT|Swarm|shell|filesystem|approval|execute/iu)
      }
      for (const forbidden of FORBIDDEN_TOOL_NAMES) {
        expect(listed.tools.some(tool => tool.name === forbidden)).toBe(false)
      }

      const calls = new Map<string, WireResult>()
      for (const name of TOOL_NAMES) {
        const result = await client.callTool({
          name,
          arguments: name === 'get_quota_snapshot' ? { provider: 'claude' } : {},
        })
        calls.set(name, result)
        expect(result.isError).not.toBe(true)
        const content = textContent(result)
        expect(() => JSON.parse(content)).not.toThrow()
        expect(new TextEncoder().encode(content).byteLength).toBeLessThanOrEqual(32 * 1024)
        expect(content).toContain('content-minimal')
        expect(content).not.toContain('C:\\Users\\')
        expect(content).not.toContain('/Users/')
        expect(content).not.toContain('/home/')
        expect(content).not.toMatch(/bearer\s+|api[_ -]?key\s*[=:]|access[_ -]?token\s*[=:]/iu)
      }

      const spendWire = JSON.stringify(calls.get('get_spend_snapshot'))
      expect(spendWire).toContain('advisor-tool-v1')
      expect(spendWire).toContain('privacy')
      expect(spendWire).toContain('unavailable')
      expect(stderr()).not.toContain('C:\\Users\\')
      expect(stderr()).not.toContain('/Users/')
      expect(stderr()).not.toContain('/home/')
      expect(stderr()).not.toMatch(/api[_ -]?key\s*[=:]|bearer\s+/iu)
    }, 30_000)
  }, 30_000)

  it('fails closed for legacy/unknown tools and invalid arguments without echoing sensitive input', async () => {
    await withStdioClient(async client => {
      const secret = 'token=sk_test_12345678901234567890'
      await expectFailClosed(client.callTool({ name: 'get_usage', arguments: {} }), secret)
      await expectFailClosed(client.callTool({ name: 'get_spend_snapshot', arguments: { prompt: secret } }), secret)
      await expectFailClosed(client.callTool({ name: 'get_quota_snapshot', arguments: { provider: 'openai' } }), secret)
    }, 30_000)
  }, 30_000)
})

describe('MCP and canonical Tools boundaries', () => {
  it('keeps a constrained startup scope immutable when a Tool call asks to widen it', async () => {
    const registry = await createMetroraToolRuntime({ period: 'today', provider: 'claude' })
    await expect(registry.execute('get_spend_snapshot', { period: 'all' })).rejects.toMatchObject({ code: 'invalid-scope' })
    await expect(registry.execute('get_quota_snapshot', { provider: 'codex' })).rejects.toMatchObject({ code: 'invalid-scope' })
  })

  it('binds MCP to the canonical Tools registry instead of defining a second factual authority', () => {
    const mcpSources = readdirSync(join(process.cwd(), 'src', 'mcp'))
      .filter(name => name.endsWith('.ts'))
      .map(name => readFileSync(join(process.cwd(), 'src', 'mcp', name), 'utf8'))
      .join('\n')
    expect(mcpSources).toMatch(/createMetroraToolRegistry|METRORA_TOOL_(?:CONTRACT|DEFINITIONS)/u)
    expect(mcpSources).toMatch(/\.\.\/tools\/(?:index|registry|contract)/u)
    expect(mcpSources).not.toMatch(/\bget_usage\b|\bget_savings\b/u)
    for (const forbidden of FORBIDDEN_TOOL_NAMES) {
      expect(mcpSources).not.toContain("'" + forbidden + "'")
      expect(mcpSources).not.toContain('"' + forbidden + '"')
    }
  })

  it('keeps canonical Tools transport- and UI-neutral', () => {
    const toolsSources = readdirSync(join(process.cwd(), 'src', 'tools'))
      .filter(name => name.endsWith('.ts'))
      .map(name => readFileSync(join(process.cwd(), 'src', 'tools', name), 'utf8'))
      .join('\n')
    expect(toolsSources).not.toMatch(/@modelcontextprotocol|from ['"](?:react|electron)|from ['"].*\/(?:act|optimization-operations)\//iu)
  })
})
