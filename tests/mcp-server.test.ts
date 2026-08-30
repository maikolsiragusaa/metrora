import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { describe, expect, it } from 'vitest'

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
  'approve_action',
  'execute_action',
  'run_core_compatibility',
  'run_bench',
  'launch_agent',
  'launch_swarm',
  'shell',
  'filesystem',
] as const

type WireResult = Awaited<ReturnType<Client['callTool']>>

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
      expect(spendWire).not.toContain('"measuredCostUSD":0')
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
    expect(toolsSources).not.toMatch(/@modelcontextprotocol|from ['"](?:react|electron)|from ['"].*\/act\//iu)
  })
})
