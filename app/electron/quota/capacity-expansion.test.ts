import { describe, expect, it, vi } from 'vitest'

import { decodeAntigravitySummary, fetchAntigravityQuota } from './antigravity'
import { decodeCopilotUsage, fetchCopilotQuota } from './copilot'
import { decodeKimiUsage, fetchKimiQuota } from './kimi'
import { sanitizeQuotaProvider } from './types'

describe('Capacity provider expansion', () => {
  it('decodes Kimi weekly and bounded rate windows with resets', () => {
    const quota = decodeKimiUsage({
      usage: { limit: '1000', used: '250', resetTime: '2026-08-30T10:00:00Z' },
      limits: [{
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        detail: { limit: 100, remaining: 60, reset_at: 1788087600 },
      }],
      user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
    })
    expect(quota).not.toBeNull()
    expect(quota).toMatchObject({
      provider: 'kimi',
      source: { kind: 'provider-api', stability: 'experimental' },
      planLabel: 'Intermediate',
    })
    expect(quota!.windows).toEqual([
      expect.objectContaining({ id: 'weekly', label: 'Weekly', usedFraction: 0.25, resetsAt: '2026-08-30T10:00:00.000Z', windowSeconds: 604_800 }),
      expect.objectContaining({ id: 'rate:0', label: '5-hour', usedFraction: 0.4, windowSeconds: 18_000 }),
    ])
  })

  it('keeps Kimi CLI credentials read-only and reports expired credentials honestly', async () => {
    const readFile = vi.fn(async (filePath: string) => filePath.endsWith('kimi-code.json')
      ? JSON.stringify({ access_token: 'secret', expires_at: 100 })
      : 'device')
    const fetch = vi.fn()
    const result = await fetchKimiQuota({
      fetch: fetch as typeof globalThis.fetch,
      readFile,
      credentialPath: '/mock/kimi-code.json',
      deviceIdPath: '/mock/device_id',
      now: () => 200_000,
    })
    expect(result.quota).toMatchObject({ provider: 'kimi', connection: 'terminalFailure', freshness: 'unavailable' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('decodes a legitimate metered Copilot percentage with provider reset evidence', () => {
    const quota = decodeCopilotUsage({
      copilot_plan: 'pro',
      quota_reset_date_utc: '2026-09-01T00:00:00Z',
      quota_snapshots: {
        premium_interactions: { entitlement: '300', remaining: '195', percent_remaining: '65', unlimited: false },
        chat: { entitlementRequests: 1000, usedRequests: 0, remainingPercentage: 100, isUnlimitedEntitlement: false, resetDate: '2026-09-02T00:00:00Z' },
      },
    })
    expect(quota).toMatchObject({
      provider: 'copilot',
      source: { kind: 'provider-internal-api', stability: 'experimental' },
      planLabel: 'Pro',
    })
    expect(quota.windows).toEqual([
      expect.objectContaining({ id: 'premium_interactions', usedFraction: 0.35, resetsAt: '2026-09-01T00:00:00.000Z', windowSeconds: null }),
      expect.objectContaining({ id: 'chat', usedFraction: 0, resetsAt: '2026-09-02T00:00:00.000Z', windowSeconds: null }),
    ])
  })

  it('fails closed for unlimited Copilot snapshots', () => {
    const quota = decodeCopilotUsage({
      quota_snapshots: {
        premium_interactions: { entitlement: -1, percent_remaining: 0, unlimited: true },
        chat: { entitlementRequests: '-1', remainingPercentage: 0, isUnlimitedEntitlement: true },
      },
    })
    expect(quota.windows).toEqual([])
  })

  it('does not turn zero-entitlement or zero-evidence placeholders into 0%-used windows', () => {
    const quota = decodeCopilotUsage({
      copilot_plan: 'business',
      quota_snapshots: {
        premium_interactions: { entitlement: '0', remaining: '0', percent_remaining: '0', unlimited: false },
        chat: { remaining: 0, percent_remaining: 0 },
      },
    })
    expect(quota.windows).toEqual([])
    expect(quota.planLabel).toBe('Business')
  })

  it('does not present token-based billing as a request percentage', () => {
    const quota = decodeCopilotUsage({
      token_based_billing: true,
      quota_snapshots: {
        premium_interactions: { entitlement: 1000, remaining: 500, percent_remaining: 50, unlimited: false },
        chat: { entitlementRequests: 1000, remainingPercentage: 50, isUnlimitedEntitlement: false },
      },
    })
    expect(quota.windows).toEqual([])
  })

  it('fails closed for malformed or unknown Copilot quota shapes', () => {
    const quota = decodeCopilotUsage({
      quota_snapshots: {
        premium_interactions: { entitlement: 'not-a-number', percent_remaining: 'unknown' },
        chat: { entitlement: 1000, percent_remaining: 101, billing_type: 'future-meter' },
      },
    })
    expect(quota.windows).toEqual([])
  })

  it('rereads Copilot provider-owned credentials once after a 401', async () => {
    let reads = 0
    const readFile = vi.fn(async () => JSON.stringify({ 'github.com': { oauth_token: ++reads <= 2 ? 'old-token' : 'new-token' } }))
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization
      if (auth === 'token old-token') return new Response('{}', { status: 401 })
      return new Response(JSON.stringify({ quota_snapshots: { chat: { entitlement: 100, percent_remaining: 50, unlimited: false } } }), { status: 200 })
    })
    const result = await fetchCopilotQuota({
      fetch: fetch as typeof globalThis.fetch,
      readFile,
      hostsPath: '/mock/hosts.json',
      appsPath: '/mock/apps.json',
      now: () => Date.parse('2026-08-25T12:00:00Z'),
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(readFile).toHaveBeenCalledTimes(4)
    expect(result.quota).toMatchObject({ provider: 'copilot', freshness: 'fresh', availability: 'available' })
    expect(result.quota.windows[0]).toMatchObject({ id: 'chat', usedFraction: 0.5 })
  })

  it('fails closed instead of selecting an arbitrary Copilot account', async () => {
    const fetch = vi.fn()
    const result = await fetchCopilotQuota({
      fetch: fetch as typeof globalThis.fetch,
      readFile: vi.fn(async (filePath: string) => filePath.endsWith('hosts.json')
        ? JSON.stringify({ 'github.com:app-a': { oauth_token: 'account-a' }, 'github.com:app-b': { oauth_token: 'account-b' } })
        : null),
      hostsPath: '/mock/hosts.json',
      appsPath: '/mock/apps.json',
    })
    expect(result.quota).toMatchObject({ provider: 'copilot', connection: 'disconnected', windows: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('decodes Antigravity summary fractions as provider windows', () => {
    const windows = decodeAntigravitySummary({
      response: {
        groups: [{
          displayName: 'Gemini Models',
          buckets: [
            { bucketId: 'weekly', displayName: 'Weekly', remaining: { remainingFraction: 0.7 } },
            { bucketId: 'session', displayName: '5-hour', remaining: { remainingFraction: 0.2 } },
          ],
        }],
      },
    })
    expect(windows).toEqual([
      expect.objectContaining({ id: 'summary:weekly', label: 'Gemini Models · Weekly', usedFraction: 0.3, windowSeconds: 604_800 }),
      expect.objectContaining({ id: 'summary:session', label: 'Gemini Models · 5-hour', usedFraction: 0.8, windowSeconds: 18_000 }),
    ])
  })

  it('discovers Antigravity on Windows through bounded local process and port probes', async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.at(-1) ?? ''
      if (command.includes('Get-CimInstance')) {
        return { stdout: `${JSON.stringify({ PID: 4242, Cmd: 'C:\\Antigravity\\language_server.exe --app_data_dir antigravity --csrf_token abcdefghijklmnop' })}\n` }
      }
      if (command.includes('Get-NetTCPConnection')) return { stdout: '48123\n' }
      return { stdout: '' }
    })
    const request = vi.fn(async (_port: number, _tls: boolean, pathName: string) => {
      if (pathName.endsWith('RetrieveUserQuotaSummary')) {
        return {
          status: 200,
          text: JSON.stringify({ response: { groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'weekly', displayName: 'Weekly', remaining: { remainingFraction: 0.75 } }] }] } }),
        }
      }
      return { status: 404, text: '{}' }
    })
    const result = await fetchAntigravityQuota({
      platform: 'win32', execFile, request,
      now: () => Date.parse('2026-08-25T12:00:00Z'),
    })
    expect(result.quota).toMatchObject({
      provider: 'antigravity',
      connection: 'connected',
      freshness: 'fresh',
      source: { kind: 'provider-loopback', stability: 'experimental' },
    })
    expect(result.quota.windows[0]).toMatchObject({ label: 'Gemini Models · Weekly', usedFraction: 0.25 })
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('distinguishes absent Antigravity authority from an eligible process whose probe fails', async () => {
    const noProcessExec = vi.fn(async (_file: string, args: string[]) => {
      return { stdout: (args.at(-1) ?? '').includes('Get-CimInstance') ? '' : '' }
    })
    const disconnected = await fetchAntigravityQuota({ platform: 'win32', execFile: noProcessExec })
    expect(disconnected.quota.connection).toBe('disconnected')

    const eligibleExec = vi.fn(async (_file: string, args: string[]) => {
      const command = args.at(-1) ?? ''
      return command.includes('Get-CimInstance')
        ? { stdout: `${JSON.stringify({ PID: 4242, Cmd: 'C:\\Antigravity\\language_server.exe --app_data_dir antigravity --https_server_port 48123 --csrf_token abcdefghijklmnop' })}\n` }
        : { stdout: '' }
    })
    const failedProbe = await fetchAntigravityQuota({
      platform: 'win32',
      execFile: eligibleExec,
      request: vi.fn(async () => null),
    })
    expect(failedProbe.quota.connection).toBe('transientFailure')
    expect(failedProbe.quota.windows).toEqual([])
  })

  it('fails closed when multiple Antigravity authorities are eligible', async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.at(-1) ?? ''
      if (!command.includes('Get-CimInstance')) return { stdout: '' }
      return {
        stdout: [
          JSON.stringify({ PID: 4242, Cmd: 'C:\\Antigravity\\language_server.exe --app_data_dir antigravity --csrf_token abcdefghijklmnop' }),
          JSON.stringify({ PID: 4343, Cmd: 'C:\\Antigravity\\language_server.exe --app_data_dir antigravity --csrf_token qrstuvwxyzabcdef' }),
        ].join('\n'),
      }
    })
    const request = vi.fn()
    const result = await fetchAntigravityQuota({ platform: 'win32', execFile, request })
    expect(result.quota.connection).toBe('transientFailure')
    expect(result.identity.state).toBe('unknown')
    expect(request).not.toHaveBeenCalled()
  })

  it('sanitizes source metadata through the renderer boundary and drops unknown values', () => {
    const base = {
      schemaVersion: 1,
      provider: 'kimi',
      authority: 'provider-reported',
      availability: 'available',
      connection: 'connected',
      freshness: 'fresh',
      observedAt: '2026-08-25T12:00:00.000Z',
      planLabel: null,
      windows: [{ id: 'weekly', label: 'Weekly', usedFraction: 0.2, resetsAt: null, windowSeconds: 604_800 }],
      credits: null,
      rateLimit: { state: 'clear', retryAt: null },
    }
    const safe = sanitizeQuotaProvider({
      ...base,
      source: { kind: 'provider-internal-api', stability: 'experimental', token: 'nope' },
      oauth_token: 'credential-secret',
      accountId: 'account-secret',
    })!
    expect(safe.source).toEqual({ kind: 'provider-internal-api', stability: 'experimental' })
    expect(JSON.stringify(safe)).not.toMatch(/credential-secret|account-secret|oauth_token|token/)
    expect(sanitizeQuotaProvider({ ...base, source: { kind: 'browser-cookie', stability: 'magic' } })?.source).toBeUndefined()
  })
})
