// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { OPENCODE_USAGE_TOOL_SOURCE } from './tool'

const temporaryDirectories: string[] = []
const originalSnapshotPath = process.env.METRORA_USAGE_SNAPSHOT_FILE

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  if (originalSnapshotPath === undefined) delete process.env.METRORA_USAGE_SNAPSHOT_FILE
  else process.env.METRORA_USAGE_SNAPSHOT_FILE = originalSnapshotPath
})

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

    const module = await import(`data:text/javascript;base64,${Buffer.from(OPENCODE_USAGE_TOOL_SOURCE).toString('base64')}`) as { default: { execute: () => Promise<string> } }
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

    const module = await import(`data:text/javascript;base64,${Buffer.from(OPENCODE_USAGE_TOOL_SOURCE).toString('base64')}`) as { default: { execute: () => Promise<string> } }

    await expect(module.default.execute()).resolves.toBe('Metrora usage snapshot is unavailable.')
  })
})
