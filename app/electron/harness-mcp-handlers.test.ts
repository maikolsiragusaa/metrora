// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { createHarnessMcpHandlers } from './harness-mcp-handlers'

describe('Harness MCP main-process handlers', () => {
  it('persists bounded config, reloads the existing Host, and never returns secrets', async () => {
    const statuses = [{ id: 'fixture', serverName: 'fixture', transport: 'stdio' as const, enabled: true, state: 'connected' as const, toolCount: 1, toolNames: ['mcp__fixture__echo'], detail: 'Connected.', checkedAt: '2026-09-03T00:00:00.000Z' }]
    const profile = { version: 1 as const, mcpServers: [], runtime: 'ollama' as const, lastLocalRuntime: 'ollama' as const, lastLocalModelByRuntime: {}, lastHostedModelByProvider: {}, llamaServerPort: 8080, reasoningByModel: {}, hostedConsentByProvider: {}, lastUsable: null, ui: { showReasoning: true, compactProcess: true, density: 'comfortable' as const } }
    const nextProfile = { ...profile, mcpServers: [{ id: 'fixture', serverName: 'fixture', enabled: true, transport: 'stdio' as const, command: 'node', args: [], cwd: null, env: {}, envRefs: {} }] }
    const host = { getMcpStatuses: vi.fn(async () => statuses), configureMcpServers: vi.fn(async () => statuses), reloadMcpServer: vi.fn(async () => statuses) }
    const profileStore = { setMcpServers: vi.fn(async () => nextProfile) }
    const credentials = {
      statusReference: vi.fn(async (reference: string) => ({ reference, state: 'ready' as const })),
      setReference: vi.fn(async (reference: string) => ({ reference, state: 'ready' as const })),
      clearReference: vi.fn(async (reference: string) => ({ reference, state: 'not-configured' as const })),
    }
    const handlers = createHarnessMcpHandlers({ host, profile: profileStore, credentials })

    await expect(handlers['metrora:harnessMcpGet']()).resolves.toEqual({ ok: true, value: statuses })
    await expect(handlers['metrora:harnessMcpSetServers']([])).resolves.toEqual({ ok: true, value: { profile: nextProfile, statuses } })
    await expect(handlers['metrora:harnessMcpReload']('fixture')).resolves.toEqual({ ok: true, value: statuses })
    await expect(handlers['metrora:harnessMcpCredentialSet']('mcp:fixture:TOKEN', 'secret-value')).resolves.toEqual({ ok: true, value: { reference: 'mcp:fixture:TOKEN', state: 'ready' } })
    expect(JSON.stringify(await handlers['metrora:harnessMcpCredentialSet']('mcp:fixture:TOKEN', 'secret-value'))).not.toContain('secret-value')
    expect(host.configureMcpServers).toHaveBeenCalledWith(nextProfile.mcpServers)
    expect(host.reloadMcpServer).toHaveBeenCalledWith('fixture')
  })

  it('rejects malformed ids before reaching Host or credential custody', async () => {
    const handlers = createHarnessMcpHandlers({
      host: { getMcpStatuses: async () => [], configureMcpServers: async () => [], reloadMcpServer: vi.fn(async () => []) },
      profile: { setMcpServers: vi.fn(async () => { throw new Error('should not run') }) },
      credentials: { statusReference: vi.fn(), setReference: vi.fn(), clearReference: vi.fn() },
    })
    await expect(handlers['metrora:harnessMcpReload']('')).resolves.toMatchObject({ ok: false, error: { kind: 'bad-args' } })
    await expect(handlers['metrora:harnessMcpCredentialStatus'](42)).resolves.toMatchObject({ ok: false, error: { kind: 'bad-args' } })
    await expect(handlers['metrora:harnessMcpCredentialSet']('mcp:fixture:TOKEN', '')).resolves.toMatchObject({ ok: false, error: { kind: 'bad-args' } })
  })
})
