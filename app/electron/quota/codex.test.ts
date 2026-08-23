import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { decodeCodexUsage, fetchCodexQuota } from './codex'

const now = Date.parse('2026-07-12T00:00:00Z')
const auth = {
  auth_mode: 'chatgpt', OPENAI_API_KEY: 'preserve-me', last_refresh: '2026-07-11T00:00:00Z',
  tokens: { access_token: 'eyJaccess.token.sig', refresh_token: 'refresh-secret', id_token: 'old-id', account_id: 'acct_1' },
}

afterEach(() => vi.restoreAllMocks())

describe('Codex quota', () => {
  it('decodes primary/secondary/additional windows, plan and numeric-string credits', () => {
    const quota = decodeCodexUsage({
      plan_type: 'pLuS',
      rate_limit: {
        primary_window: { used_percent: 20, reset_at: 1_800_000_000, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 80, reset_at: 1_800_100_000, limit_window_seconds: 604_800 },
      },
      additional_rate_limits: [{
        limit_name: 'GPT-5', rate_limit: {
          primary_window: { used_percent: 12, reset_at: 1_800_000_000, limit_window_seconds: 3600 },
          secondary_window: { used_percent: 0, reset_at: 1_800_000_000, limit_window_seconds: 86_400 },
        },
      }],
      credits: { balance: '3.5' },
    })
    expect(quota.planLabel).toBe('Plus')
    expect(quota.windows.map(row => row.label)).toEqual(['5-hour', 'Weekly', 'GPT-5 · Hour', 'GPT-5 · Daily'])
    expect(quota.windows.map(row => row.id)).toEqual(['primary', 'secondary', 'additional:GPT-5:primary', 'additional:GPT-5:secondary'])
    expect(quota.windows[0]).toMatchObject({ usedFraction: 0.2, resetsAt: '2027-01-15T08:00:00.000Z', windowSeconds: 18_000 })
    expect(quota.credits).toEqual({ balance: 3.5, currency: 'USD' })
  })

  it('promotes secondary when primary is absent', () => {
    const quota = decodeCodexUsage({ rate_limit: { secondary_window: { used_percent: 9, reset_at: 1_800_000_000, limit_window_seconds: 604_800 } } })
    expect(quota.windows[0]).toMatchObject({ id: 'secondary', label: 'Weekly' })
    expect(quota.windows).toHaveLength(1)
  })

  it('preserves an explicit zero credit balance and keeps absent credits unavailable', () => {
    expect(decodeCodexUsage({ credits: { balance: 0 } }).credits).toEqual({ balance: 0, currency: 'USD' })
    expect(decodeCodexUsage({}).credits).toBeNull()
  })

  it('does not treat an empty successful response as fresh quota', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    const result = await fetchCodexQuota({ fetch: fetchMock, readFile: vi.fn(async () => JSON.stringify(auth)), now: () => now })
    expect(result.quota).toMatchObject({
      connection: 'connected', availability: 'unavailable', freshness: 'unavailable', observedAt: null,
      windows: [], credits: null, planLabel: null,
    })
  })

  it('treats plan-only provider data as a fresh factual snapshot', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ plan_type: 'pro' }), { status: 200 }))
    const result = await fetchCodexQuota({ fetch: fetchMock, readFile: vi.fn(async () => JSON.stringify(auth)), now: () => now })
    expect(result.quota).toMatchObject({ connection: 'connected', availability: 'available', freshness: 'fresh', planLabel: 'Pro', windows: [], credits: null })
    expect(result.quota.observedAt).toBe(new Date(now).toISOString())
  })

  it('treats credits-only responses as factual, including explicit zero', async () => {
    const readFile = vi.fn(async () => JSON.stringify(auth))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ credits: { balance: 3.5 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ credits: { balance: 0 } }), { status: 200 }))

    const positive = await fetchCodexQuota({ fetch: fetchMock, readFile, now: () => now })
    const zero = await fetchCodexQuota({ fetch: fetchMock, readFile, now: () => now })
    for (const result of [positive, zero]) {
      expect(result.quota).toMatchObject({ connection: 'connected', availability: 'available', freshness: 'fresh', windows: [] })
      expect(result.quota.observedAt).toBe(new Date(now).toISOString())
    }
    expect(positive.quota.credits).toEqual({ balance: 3.5, currency: 'USD' })
    expect(zero.quota.credits).toEqual({ balance: 0, currency: 'USD' })
  })

  it('returns disconnected without credentials', async () => {
    const fetchMock = vi.fn()
    const result = await fetchCodexQuota({ fetch: fetchMock, readFile: vi.fn(async () => null) })
    expect(result.quota.connection).toBe('disconnected')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends account id and uses Retry-After header for 429', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
    const result = await fetchCodexQuota({ fetch: fetchMock, readFile: vi.fn(async () => JSON.stringify(auth)), now: () => now })
    expect(result.retryAfterSeconds).toBe(120)
    const usageInit = (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1]
    expect(usageInit.headers).toMatchObject({ 'ChatGPT-Account-Id': 'acct_1', 'User-Agent': 'Metrora' })
  })

  it('never refreshes or writes a stale provider-owned auth document', async () => {
    const stale = { ...auth, last_refresh: '2026-07-01T00:00:00Z' }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ plan_type: 'pro', rate_limit: {} }), { status: 200 }))
    const result = await fetchCodexQuota({ fetch: fetchMock as typeof fetch, readFile: vi.fn(async () => JSON.stringify(stale)), now: () => now })
    expect(result.quota.connection).toBe('connected')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://chatgpt.com/backend-api/wham/usage', expect.anything())
  })

  it('re-reads once after 401 and retries when Codex owner rotated the token', async () => {
    const rotated = { ...auth, tokens: { ...auth.tokens, access_token: 'eyJrotated.access.sig' } }
    let reads = 0
    const readFile = vi.fn(async () => JSON.stringify(reads++ === 0 ? auth : rotated))
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.headers as Record<string, string>).Authorization === 'Bearer eyJrotated.access.sig'
        ? new Response(JSON.stringify({ rate_limit: {} }), { status: 200 })
        : new Response('', { status: 401 }))
    const result = await fetchCodexQuota({ fetch: fetchMock as typeof fetch, readFile })
    expect(result.quota.connection).toBe('connected')
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns transient after 401 when the provider-owned token is unchanged', async () => {
    const readFile = vi.fn(async () => JSON.stringify(auth))
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }))
    const result = await fetchCodexQuota({ fetch: fetchMock as typeof fetch, readFile })
    expect(result.quota.connection).toBe('transientFailure')
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// The Metrora menubar caches its Codex OAuth as a Swift CredentialRecord blob.
const menubarRecord = JSON.stringify({
  accessToken: 'eyJmenubar.token.sig', refreshToken: 'mb-refresh', idToken: 'mb-id', accountId: 'acct_mb', lastRefresh: 1_234_567,
})

describe('Codex menubar keychain source', () => {
  const originalPlatform = process.platform
  beforeAll(() => Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true }))
  afterAll(() => Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true }))

  it('resolves quota from the menubar keychain when auth.json is absent, read-only', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ plan_type: 'pro', rate_limit: { primary_window: { used_percent: 10, reset_at: 1_800_000_000, limit_window_seconds: 18_000 } } }), { status: 200 }))
    const keychain = vi.fn(async () => ({ status: 'found' as const, value: menubarRecord }))
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => null), keychain, allowKeychain: true })
    expect(result.quota.connection).toBe('connected')
    expect(result.quota.planLabel).toBe('Pro')
    const init = (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer eyJmenubar.token.sig', 'ChatGPT-Account-Id': 'acct_mb' })
    expect(keychain).toHaveBeenCalledWith('eu.metrora.menubar.codex.oauth.v1')
  })

  it('re-reads the keychain once on a 401 and adopts a rotated token, never a refresh POST', async () => {
    const rotated = JSON.stringify({ accessToken: 'eyJrotated.token.sig', refreshToken: 'mb-refresh2', idToken: 'mb-id', accountId: 'acct_mb' })
    let reads = 0
    const keychain = vi.fn(async () => ({ status: 'found' as const, value: reads++ === 0 ? menubarRecord : rotated }))
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.headers as Record<string, string>).Authorization === 'Bearer eyJrotated.token.sig'
      ? new Response(JSON.stringify({ plan_type: 'pro', rate_limit: {} }), { status: 200 })
      : new Response('', { status: 401 }))
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => null), keychain, allowKeychain: true })
    expect(result.quota.connection).toBe('connected')
    expect(fetchMock.mock.calls.every(call => String(call[0]).includes('/wham/usage'))).toBe(true)
    expect(keychain).toHaveBeenCalledTimes(2)
  })

  it('returns transientFailure on a keychain 401 with no rotation, never writing back', async () => {
    const keychain = vi.fn(async () => ({ status: 'found' as const, value: menubarRecord }))
    const fetchMock = vi.fn(async (_url: string) => new Response('', { status: 401 }))
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => null), keychain, allowKeychain: true })
    expect(result.quota.connection).toBe('transientFailure')
    expect(fetchMock.mock.calls.every(call => String(call[0]).includes('/wham/usage'))).toBe(true)
  })

  it('surfaces accessDenied when the menubar keychain is blocked and no file exists', async () => {
    const keychain = vi.fn(async () => ({ status: 'accessDenied' as const }))
    const fetchMock = vi.fn()
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => null), keychain, allowKeychain: true })
    expect(result.quota.connection).toBe('accessDenied')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prefers the menubar keychain over ~/.codex/auth.json and keeps it read-only', async () => {
    const keychain = vi.fn(async () => ({ status: 'found' as const, value: menubarRecord }))
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ plan_type: 'plus', rate_limit: {} }), { status: 200 }))
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => JSON.stringify(auth)), keychain, allowKeychain: true, now: () => now })
    expect(result.quota.connection).toBe('connected')
    const init = (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer eyJmenubar.token.sig' })
  })

  it('falls through to ~/.codex/auth.json when the keychain has no menubar item', async () => {
    const keychain = vi.fn(async () => ({ status: 'notFound' as const }))
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ plan_type: 'plus', rate_limit: {} }), { status: 200 }))
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => JSON.stringify(auth)), keychain, allowKeychain: true, now: () => now })
    expect(result.quota.connection).toBe('connected')
    const init = (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer eyJaccess.token.sig' })
  })
})
