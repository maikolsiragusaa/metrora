import { useState } from 'react'
import type { FormEvent } from 'react'

import { metrora } from '../lib/ipc'
import type {
  HarnessConversation,
  HarnessHostedProvider,
  HarnessLocalProbe,
  HarnessMcpServerConfig,
  HarnessMcpServerStatus,
  HarnessRuntimeChoice,
  HarnessRuntimeProfileV1,
  HarnessWorkspace,
} from '../../electron/harness-runtime-types'

type HarnessSettingsProps = {
  profile: HarnessRuntimeProfileV1
  runtime: HarnessRuntimeChoice
  hostedProvider: HarnessHostedProvider
  hostedConsent: 'unknown' | 'accepted' | 'declined'
  localProbe: HarnessLocalProbe | null
  hostedProbe: { detail: string; credentialState: string } | null
  workspace: HarnessWorkspace | null
  mcpStatuses: HarnessMcpServerStatus[]
  onPortChange: (port: number) => Promise<void>
  onCredentialChange: (secret: string) => Promise<void>
  onConsentChange: (state: 'unknown' | 'accepted' | 'declined') => Promise<void>
  onMcpSave: (servers: HarnessMcpServerConfig[]) => Promise<{ profile: HarnessRuntimeProfileV1; statuses: HarnessMcpServerStatus[] }>
  onMcpReload: (serverId: string) => Promise<HarnessMcpServerStatus[]>
  onCheckConformance: () => void
  conformance?: HarnessConversation['conformance']
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message) : String(error)
}

function parseKeyValueSettings(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of value.split(/\r?\n/u)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const item = line.slice(separator + 1).trim()
    if (key && item) result[key] = item
  }
  return result
}

function parseArgsSettings(value: string): string[] {
  return value.split(/\r?\n|,/u).map(item => item.trim()).filter(Boolean)
}

function mcpStatusLabel(status: HarnessMcpServerStatus | undefined): string {
  if (!status) return 'Not mounted'
  return status.state === 'connected' ? `${status.toolCount} Tool${status.toolCount === 1 ? '' : 's'}` : status.state.replaceAll('-', ' ')
}

export function HarnessSettings({ profile, runtime, hostedProvider, hostedConsent, localProbe, hostedProbe, workspace, mcpStatuses, onPortChange, onCredentialChange, onConsentChange, onMcpSave, onMcpReload, onCheckConformance, conformance }: HarnessSettingsProps) {
  const [port, setPort] = useState(String(profile.llamaServerPort))
  const [secret, setSecret] = useState('')
  const [mcpName, setMcpName] = useState('')
  const [mcpTransport, setMcpTransport] = useState<HarnessMcpServerConfig['transport']>('stdio')
  const [mcpCommand, setMcpCommand] = useState('')
  const [mcpArgs, setMcpArgs] = useState('')
  const [mcpCwd, setMcpCwd] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpEnv, setMcpEnv] = useState('')
  const [mcpEnvRefs, setMcpEnvRefs] = useState('')
  const [mcpHeaders, setMcpHeaders] = useState('')
  const [mcpHeaderRefs, setMcpHeaderRefs] = useState('')
  const [mcpSecretRef, setMcpSecretRef] = useState('')
  const [mcpSecret, setMcpSecret] = useState('')
  const [mcpCredentialState, setMcpCredentialState] = useState<string | null>(null)
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpNotice, setMcpNotice] = useState<string | null>(null)

  const mutateMcp = async (servers: HarnessMcpServerConfig[]): Promise<boolean> => {
    setMcpBusy(true)
    setMcpNotice(null)
    try { await onMcpSave(servers); return true }
    catch (error) { setMcpNotice(errorText(error)); return false }
    finally { setMcpBusy(false) }
  }

  const addMcpServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = mcpName.trim()
    if (!name) { setMcpNotice('Enter a stable MCP server name first.'); return }
    const base = { id: name, serverName: name, enabled: true } as const
    const next: HarnessMcpServerConfig = mcpTransport === 'stdio'
      ? { ...base, transport: 'stdio', command: mcpCommand.trim(), args: parseArgsSettings(mcpArgs), cwd: mcpCwd.trim() || null, env: parseKeyValueSettings(mcpEnv), envRefs: parseKeyValueSettings(mcpEnvRefs) }
      : { ...base, transport: 'streamable-http', url: mcpUrl.trim(), headers: parseKeyValueSettings(mcpHeaders), headerRefs: parseKeyValueSettings(mcpHeaderRefs) }
    if (profile.mcpServers.some(server => server.serverName === name)) { setMcpNotice('That MCP server name is already configured.'); return }
    const saved = await mutateMcp([...profile.mcpServers, next])
    if (saved) {
      setMcpName(''); setMcpCommand(''); setMcpArgs(''); setMcpCwd(''); setMcpUrl(''); setMcpEnv(''); setMcpEnvRefs(''); setMcpHeaders(''); setMcpHeaderRefs('')
    }
  }

  const saveMcpCredential = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (typeof metrora.harnessMcpCredentialSet !== 'function') { setMcpCredentialState('unavailable'); return }
    try {
      const result = await metrora.harnessMcpCredentialSet(mcpSecretRef.trim(), mcpSecret)
      setMcpCredentialState(result.state)
      setMcpSecret('')
    } catch (error) { setMcpCredentialState(errorText(error)) }
  }

  return <aside className="harness-settings" aria-label="Harness settings"><div className="harness-settings-head"><div><span className="harness-eyebrow">RUNTIME SETTINGS</span><h2>Provider & Workspace</h2></div><span className="harness-settings-state">{runtime === 'hosted' ? hostedProbe?.credentialState ?? 'not checked' : localProbe?.discoveryState ?? 'not checked'}</span></div><div className="harness-settings-grid">
    {runtime === 'llama-server' && <label><span>llama.cpp loopback port</span><div className="harness-inline-input"><input aria-label="llama.cpp port" inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} /><button type="button" onClick={() => void onPortChange(Number(port))}>Apply</button></div><small>Default 8080 · loopback only</small></label>}
    {runtime === 'hosted' && <><label><span>{hostedProvider} credential</span><div className="harness-inline-input"><input aria-label="Hosted provider credential" type="password" autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} placeholder="Stored in the OS vault" /><button type="button" onClick={() => { void onCredentialChange(secret); setSecret('') }}>Save</button></div><small>{hostedProbe?.detail ?? 'Credentials never enter the Session or profile.'}</small></label><label className="harness-consent"><span>Hosted provider consent</span><select aria-label="Hosted provider consent" value={hostedConsent} onChange={event => void onConsentChange(event.target.value as 'unknown' | 'accepted' | 'declined')}><option value="unknown">Ask before sending</option><option value="accepted">Allow hosted requests</option><option value="declined">Decline hosted requests</option></select><small>Requests go directly to {hostedProvider}; credentials stay in the OS vault and never enter the Session.</small></label></>}
    <div className="harness-settings-fact"><span>Workspace</span><strong>{workspace?.displayName ?? 'Not selected'}</strong><small>{workspace ? 'Coding Tools are fenced to this folder.' : 'Choose a local folder from the header.'}</small></div>
    <div className="harness-settings-fact"><span>Exact model conformance</span><strong>{conformance?.state ?? 'Not checked'}</strong><small>Verified requires a native Tool round trip and final synthesis.</small><button type="button" className="harness-link-button" onClick={onCheckConformance}>Run conformance again</button></div>
    <section className="harness-mcp-panel" aria-label="MCP server settings"><div className="harness-mcp-heading"><div><span className="harness-eyebrow">TOOL EXTENSIONS</span><h3>MCP servers</h3></div><span className="harness-mcp-count">{profile.mcpServers.length}/16</span></div><p className="harness-mcp-intro">Connect external Tools to the same Agent Session. Every MCP call stays visible and requires Shield approval.</p>
      {profile.mcpServers.length > 0 && <div className="harness-mcp-list">{profile.mcpServers.map(server => { const status = mcpStatuses.find(item => item.id === server.id); return <div className={`harness-mcp-server ${status?.state ?? 'unknown'}`} key={server.id}><div className="harness-mcp-server-icon">⌘</div><div className="harness-mcp-server-copy"><div><strong>{server.serverName}</strong><span className={`harness-mcp-status ${status?.state ?? 'unknown'}`}><i />{mcpStatusLabel(status)}</span></div><small>{server.transport === 'stdio' ? server.command : server.url}</small>{status?.detail && <em>{status.detail}</em>}</div><div className="harness-mcp-server-actions"><button type="button" className="harness-link-button" disabled={mcpBusy} onClick={() => void mutateMcp(profile.mcpServers.map(item => item.id === server.id ? { ...item, enabled: !item.enabled } : item))}>{server.enabled ? 'Disable' : 'Enable'}</button><button type="button" className="harness-link-button" disabled={mcpBusy} onClick={() => void onMcpReload(server.id).catch(error => setMcpNotice(errorText(error)))}>Reload</button><button type="button" className="harness-link-button danger" disabled={mcpBusy} onClick={() => void mutateMcp(profile.mcpServers.filter(item => item.id !== server.id))}>Remove</button></div></div> })}</div>}
      <form className="harness-mcp-form" onSubmit={event => void addMcpServer(event)}><div className="harness-mcp-form-title"><strong>Add a server</strong><small>Configuration is bounded and stored without secrets.</small></div><div className="harness-mcp-form-grid"><label><span>Server name</span><input aria-label="MCP server name" value={mcpName} onChange={event => setMcpName(event.target.value)} placeholder="filesystem" /></label><label><span>Transport</span><select aria-label="MCP transport" value={mcpTransport} onChange={event => setMcpTransport(event.target.value as HarnessMcpServerConfig['transport'])}><option value="stdio">Local stdio</option><option value="streamable-http">Streamable HTTP</option></select></label>{mcpTransport === 'stdio' ? <><label><span>Command</span><input aria-label="MCP command" value={mcpCommand} onChange={event => setMcpCommand(event.target.value)} placeholder="npx" /></label><label><span>Arguments</span><textarea aria-label="MCP arguments" value={mcpArgs} onChange={event => setMcpArgs(event.target.value)} placeholder="-y&#10;@modelcontextprotocol/server-filesystem" rows={2} /></label><label><span>Working directory</span><input aria-label="MCP working directory" value={mcpCwd} onChange={event => setMcpCwd(event.target.value)} placeholder="Absolute path (optional)" /></label><label><span>Environment · non-secret</span><textarea aria-label="MCP environment" value={mcpEnv} onChange={event => setMcpEnv(event.target.value)} placeholder="MODE=local" rows={2} /></label><label><span>Environment · protected refs</span><textarea aria-label="MCP environment refs" value={mcpEnvRefs} onChange={event => setMcpEnvRefs(event.target.value)} placeholder="TOKEN=mcp:server:TOKEN" rows={2} /></label></> : <><label className="wide"><span>Server URL</span><input aria-label="MCP server URL" value={mcpUrl} onChange={event => setMcpUrl(event.target.value)} placeholder="https://example.com/mcp" /></label><label><span>Headers · non-secret</span><textarea aria-label="MCP headers" value={mcpHeaders} onChange={event => setMcpHeaders(event.target.value)} placeholder="X-Client=metrora" rows={2} /></label><label><span>Headers · protected refs</span><textarea aria-label="MCP header refs" value={mcpHeaderRefs} onChange={event => setMcpHeaderRefs(event.target.value)} placeholder="Authorization=mcp:server:AUTH" rows={2} /></label></>}</div><button type="submit" className="harness-mcp-add" disabled={mcpBusy}>Add MCP server <span>＋</span></button></form>
      <form className="harness-mcp-credential" onSubmit={event => void saveMcpCredential(event)}><div><strong>Protected credential</strong><small>Saved only in the OS vault; never sent to the renderer profile.</small></div><input aria-label="MCP credential reference" value={mcpSecretRef} onChange={event => setMcpSecretRef(event.target.value)} placeholder="mcp:server:AUTH" /><div className="harness-inline-input"><input aria-label="MCP protected secret" type="password" autoComplete="off" value={mcpSecret} onChange={event => setMcpSecret(event.target.value)} placeholder="Secret value" /><button type="submit">Save</button></div>{mcpCredentialState && <small className="harness-mcp-credential-state">{mcpCredentialState}</small>}</form>
      {mcpNotice && <div className="harness-mcp-notice" role="alert">{mcpNotice}</div>}
    </section>
  </div></aside>
}
