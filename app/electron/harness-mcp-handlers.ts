import type { HarnessCredentialStore } from './harness-credentials.mjs' with { "resolution-mode": "import" }
import type { HarnessRuntimeProfileStore } from './harness-profile.mjs' with { "resolution-mode": "import" }
import type { HarnessMcpServerStatus } from './harness-runtime-types.js'

type HarnessMcpHost = {
  getMcpStatuses(): Promise<HarnessMcpServerStatus[]>
  configureMcpServers(servers: unknown): Promise<HarnessMcpServerStatus[]>
  reloadMcpServer(serverId: string): Promise<HarnessMcpServerStatus[]>
}

type Handler = (...args: any[]) => Promise<any>

/** Main-process-only MCP IPC surface. It persists bounded config, mounts it on
 * the already-running DSH Host, and never returns protected secret values. */
export function createHarnessMcpHandlers(options: {
  host: HarnessMcpHost
  profile: Pick<HarnessRuntimeProfileStore, 'setMcpServers'>
  credentials: Pick<HarnessCredentialStore, 'statusReference' | 'setReference' | 'clearReference'>
}): Record<string, Handler> {
  const { host, profile, credentials } = options
  return {
    'metrora:harnessMcpGet': async () => ({ ok: true, value: await host.getMcpStatuses() }),
    'metrora:harnessMcpSetServers': async (servers: unknown) => {
      try {
        const nextProfile = await profile.setMcpServers(servers)
        const statuses = await host.configureMcpServers(nextProfile.mcpServers)
        return { ok: true, value: { profile: nextProfile, statuses } }
      } catch (error) {
        return { ok: false, error: { kind: 'bad-args', message: error instanceof Error ? error.message : 'MCP configuration could not be saved.' } }
      }
    },
    'metrora:harnessMcpReload': async (serverId: unknown) => {
      if (typeof serverId !== 'string' || !serverId.trim()) return { ok: false, error: { kind: 'bad-args', message: 'MCP server id is invalid.' } }
      try { return { ok: true, value: await host.reloadMcpServer(serverId) } }
      catch (error) { return { ok: false, error: { kind: 'unavailable', message: error instanceof Error ? error.message : 'MCP server could not be reloaded.' } } }
    },
    'metrora:harnessMcpCredentialStatus': async (reference: unknown) => {
      if (typeof reference !== 'string') return { ok: false, error: { kind: 'bad-args', message: 'MCP credential reference is invalid.' } }
      try { return { ok: true, value: await credentials.statusReference(reference) } }
      catch (error) { return { ok: false, error: { kind: 'bad-args', message: error instanceof Error ? error.message : 'MCP credential reference is invalid.' } } }
    },
    'metrora:harnessMcpCredentialSet': async (reference: unknown, secret: unknown) => {
      if (typeof reference !== 'string' || typeof secret !== 'string' || secret.length === 0 || secret.length > 16 * 1024) return { ok: false, error: { kind: 'bad-args', message: 'MCP credential input is invalid.' } }
      try { return { ok: true, value: await credentials.setReference(reference, secret) } }
      catch (error) { return { ok: false, error: { kind: 'bad-args', message: error instanceof Error ? error.message : 'MCP credential could not be saved.' } } }
    },
    'metrora:harnessMcpCredentialClear': async (reference: unknown) => {
      if (typeof reference !== 'string') return { ok: false, error: { kind: 'bad-args', message: 'MCP credential reference is invalid.' } }
      try { return { ok: true, value: await credentials.clearReference(reference) } }
      catch (error) { return { ok: false, error: { kind: 'bad-args', message: error instanceof Error ? error.message : 'MCP credential reference is invalid.' } } }
    },
  }
}
