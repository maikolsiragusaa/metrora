// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createOpenCodeMetroraToolSource, OPENCODE_METRORA_TOOL_SOURCES, OPENCODE_USAGE_TOOL_SOURCE } from './tool'
import { OPENCODE_METRORA_TOOL_IDS } from './types'

const temporaryDirectories: string[] = []
const originalSnapshotPath = process.env.METRORA_USAGE_SNAPSHOT_FILE
const originalBridgeSpec = process.env.METRORA_TOOL_BRIDGE_SPEC

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  if (originalSnapshotPath === undefined) delete process.env.METRORA_USAGE_SNAPSHOT_FILE
  else process.env.METRORA_USAGE_SNAPSHOT_FILE = originalSnapshotPath
  if (originalBridgeSpec === undefined) delete process.env.METRORA_TOOL_BRIDGE_SPEC
  else process.env.METRORA_TOOL_BRIDGE_SPEC = originalBridgeSpec
})

function importToolSource(source: string): Promise<{ default: { args: Record<string, unknown>; execute: (args?: unknown, context?: unknown) => Promise<string> } }> {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) as Promise<{ default: { args: Record<string, unknown>; execute: (args?: unknown, context?: unknown) => Promise<string> } }>
}

function bridgeEntry(directory: string, body: string): string {
  const entry = join(directory, 'bridge.mjs')
  writeFileSync(entry, body)
  process.env.METRORA_TOOL_BRIDGE_SPEC = JSON.stringify({
    command: [process.execPath, entry, 'tools', 'call'],
    environment: {},
  })
  return entry
}

describe('Metrora OpenCode tool runtime file', () => {
  it('is discovered as a dependency-free module and returns only a bounded snapshot', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'metrora-opencode-tool-'))
    temporaryDirectories.push(directory)
    const snapshotPath = join(directory, 'snapshot.json')
    const toolPath = join(directory, 'metrora_usage_snapshot.mjs')
    writeFileSync(snapshotPath, JSON.stringify({
      schemaVersion: 'metrora.usage-snapshot.v1',
      generatedAt: '\u00002026-09-04T12:00:00.000Z',
      period: 'today',
      available: true,
      costUSD: 12.5,
      providers: [{ id: 'codex', label: 'Codex', costUSD: 12.5 }],
      padding: 'x'.repeat(20_000),
    }))
    writeFileSync(toolPath, OPENCODE_USAGE_TOOL_SOURCE)
    process.env.METRORA_USAGE_SNAPSHOT_FILE = snapshotPath

    const module = await importToolSource(OPENCODE_USAGE_TOOL_SOURCE)
    const output = await module.default.execute()

    expect(output.length).toBeLessThanOrEqual(8_000)
    expect(output).toContain('metrora.usage-snapshot.v1')
    expect(output).toContain('today')
    expect(output).toContain('2026-09-04T12:00:00.000Z')
    expect(output).not.toContain('\\u0000')
    expect(output).not.toContain('padding')
    expect(readFileSync(toolPath, 'utf8')).not.toContain('fetch(')
  })

  it('fails closed when the snapshot path is unavailable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'metrora-opencode-tool-'))
    temporaryDirectories.push(directory)
    const toolPath = join(directory, 'metrora_usage_snapshot.mjs')
    writeFileSync(toolPath, OPENCODE_USAGE_TOOL_SOURCE)
    delete process.env.METRORA_USAGE_SNAPSHOT_FILE

    const module = await importToolSource(OPENCODE_USAGE_TOOL_SOURCE)

    await expect(module.default.execute()).resolves.toBe('Metrora usage snapshot is unavailable.')
  })

  it('writes all seven canonical tools with plain bounded schemas and no local data access', async () => {
    expect(Object.keys(OPENCODE_METRORA_TOOL_SOURCES)).toEqual([...OPENCODE_METRORA_TOOL_IDS])
    for (const toolId of OPENCODE_METRORA_TOOL_IDS) {
      const module = await importToolSource(OPENCODE_METRORA_TOOL_SOURCES[toolId])
      expect(module.default.args).toHaveProperty('filters')
      expect(module.default.args.filters).toMatchObject({ type: 'object', required: [], additionalProperties: false })
      const properties = module.default.args.filters as { properties?: Record<string, unknown> }
      if (toolId === 'metrora_get_spend_snapshot' || toolId === 'metrora_get_model_efficiency' || toolId === 'metrora_get_overview_snapshot') {
        expect(properties.properties).toHaveProperty('model')
      } else {
        expect(properties.properties).not.toHaveProperty('model')
      }
      expect(OPENCODE_METRORA_TOOL_SOURCES[toolId]).toContain('METRORA_TOOL_BRIDGE_SPEC')
      expect(OPENCODE_METRORA_TOOL_SOURCES[toolId]).toContain('shell: false')
      expect(OPENCODE_METRORA_TOOL_SOURCES[toolId]).not.toContain('fetch(')
      expect(OPENCODE_METRORA_TOOL_SOURCES[toolId]).not.toContain('node:fs')
      expect(OPENCODE_METRORA_TOOL_SOURCES[toolId]).not.toContain('METRORA_USAGE_SNAPSHOT_FILE')
    }
    const spend = await importToolSource(OPENCODE_METRORA_TOOL_SOURCES.metrora_get_spend_snapshot)
    expect(spend.default.args.filters).toMatchObject({ properties: { model: expect.any(Object), period: expect.any(Object) } })
  })

  it('passes one JSON argument through the argv-only bridge and returns canonical JSON', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'metrora-opencode-tool-bridge-'))
    temporaryDirectories.push(directory)
    bridgeEntry(directory, [
      'const args = process.argv.slice(2);',
      'process.stdout.write(JSON.stringify({ tool: args[2], args: JSON.parse(args[4]) }));',
    ].join('\n'))
    const module = await importToolSource(OPENCODE_METRORA_TOOL_SOURCES.metrora_get_spend_snapshot)

    await expect(module.default.execute({ filters: { period: 'today', model: 'model;still-one-argv' } })).resolves.toBe(JSON.stringify({
      tool: 'metrora_get_spend_snapshot',
      args: { period: 'today', model: 'model;still-one-argv' },
    }))
  })

  it('returns clean unavailable output for missing, malformed, oversized, nonzero and cancelled bridges', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'metrora-opencode-tool-bridge-'))
    temporaryDirectories.push(directory)
    const module = await importToolSource(createOpenCodeMetroraToolSource('metrora_get_coverage_report', { timeoutMs: 50 }))

    delete process.env.METRORA_TOOL_BRIDGE_SPEC
    await expect(module.default.execute({ filters: { period: 'today' } })).resolves.toBe('Metrora tool unavailable.')

   bridgeEntry(directory, 'process.stdout.write("not-json")')
   await expect(module.default.execute({ filters: { period: 'today' } })).resolves.toBe('Metrora tool unavailable.')

   bridgeEntry(directory, 'process.stdout.write("x".repeat(40000)); setInterval(() => {}, 1000)')
   await expect(module.default.execute({ filters: { period: 'today' } })).resolves.toBe('Metrora tool unavailable.')
    process.env.METRORA_TOOL_BRIDGE_SPEC = '{malformed'
    await expect(module.default.execute({ filters: { period: 'today' } })).resolves.toBe('Metrora tool unavailable.')

   bridgeEntry(directory, 'process.exit(7)')
   await expect(module.default.execute({ filters: { period: 'today' } })).resolves.toBe('Metrora tool unavailable.')

    bridgeEntry(directory, 'process.stderr.write("secret-stderr".repeat(1000)); setInterval(() => {}, 1000)')
    await expect(module.default.execute({ filters: { period: 'today' } })).resolves.toBe('Metrora tool unavailable.')

   bridgeEntry(directory, 'setInterval(() => {}, 1000)')
   await expect(module.default.execute({ filters: { period: 'today' } })).resolves.toBe('Metrora tool unavailable.')

    const controller = new AbortController()
    bridgeEntry(directory, 'setInterval(() => {}, 1000)')
    const pending = module.default.execute({ filters: { period: 'today' } }, { abort: controller.signal })
    controller.abort()
    await expect(pending).resolves.toBe('Metrora tool unavailable.')
  })
})
