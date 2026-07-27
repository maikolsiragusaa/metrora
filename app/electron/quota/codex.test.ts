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
    expect(quota.primary?.label).toBe('5-hour')
    expect(quota.details.map(row => row.label)).toEqual(['5-hour', 'Weekly', 'GPT-5 · Hour'])
    expect(quota.footerLines).toEqual(['Credits remaining · $3.50'])
  })

  it('promotes secondary when primary is absent', () => {
    const quota = decodeCodexUsage({ rate_limit: { secondary_window: { used_percent: 9, reset_at: 1_800_000_000, limit_window_seconds: 604_800 } } })
    expect(quota.primary?.label).toBe('Weekly')
    expect(quota.details).toHaveLength(1)
  })

  // Shape captured from a live ChatGPT Enterprise workspace.
  const enterpriseBody = {
    plan_type: 'business',
    rate_limit: null,
    additional_rate_limits: null,
    credits: { has_credits: false, unlimited: false, balance: null },
    spend_control: {
      reached: false,
      individual_limit: {
        source: 'workspace_spend_controls',
        limit: '10000',
        used: '3028.9909675121307',
        remaining: '6971.009032487869',
        used_percent: 30,
        remaining_percent: 70,
        reset_after_seconds: 441_896,
        reset_at: 1_785_542_400,
      },
    },
    rate_limit_reset_credits: { available_count: 0 },
  }

  it('surfaces the spend-control credit limit when there are no rate windows', () => {
    const quota = decodeCodexUsage(enterpriseBody)
    expect(quota.primary).toEqual({
      label: 'Monthly usage limit · 3,029 / 10,000 credits',
      percent: 0.3,
      resetsAt: new Date(1_785_542_400 * 1000).toISOString(),
    })
    expect(quota.details).toEqual([quota.primary])
    expect(quota.planLabel).toBe('Business')
    expect(quota.footerLines).toEqual([])
  })

  it('keeps rate windows primary and appends the credit limit alongside them', () => {
    const quota = decodeCodexUsage({
      ...enterpriseBody,
      rate_limit: { primary_window: { used_percent: 20, reset_at: 1_800_000_000, limit_window_seconds: 18_000 } },
    })
    expect(quota.primary?.label).toBe('5-hour')
    expect(quota.details.map(row => row.label)).toEqual([
      '5-hour',
      'Monthly usage limit · 3,029 / 10,000 credits',
    ])
  })

  it.each([
    ['top level', (limit: unknown) => ({ individual_limit: limit })],
    ['camelCase key', (limit: unknown) => ({ spend_control: { individualLimit: limit } })],
    ['nested in rate_limit', (limit: unknown) => ({ rate_limit: { individual_limit: limit } })],
  ])('reads the credit limit positioned at %s', (_name, wrap) => {
    const quota = decodeCodexUsage(wrap({ limit: 10_000, used: 2500, used_percent: 25 }))
    expect(quota.primary?.percent).toBe(0.25)
    expect(quota.primary?.label).toBe('Monthly usage limit · 2,500 / 10,000 credits')
  })

  it('derives the percent from remaining_percent, then from used/limit', () => {
    const fromRemaining = decodeCodexUsage({ spend_control: { individual_limit: { limit: 10_000, remaining_percent: 70 } } })
    expect(fromRemaining.primary?.percent).toBeCloseTo(0.3)
    expect(fromRemaining.primary?.label).toBe('Monthly usage limit · 3,000 / 10,000 credits')

    const fromRatio = decodeCodexUsage({ spend_control: { individual_limit: { limit: 400, used: 100 } } })
    expect(fromRatio.primary?.percent).toBeCloseTo(0.25)
  })

  it('ignores a spend control with no usable limit', () => {
    for (const individual_limit of [{ limit: 0, used: 5 }, { limit: null }, { used_percent: 40 }, null]) {
      const quota = decodeCodexUsage({ spend_control: { individual_limit } })
      expect(quota.primary).toBeNull()
      expect(quota.details).toEqual([])
    }
  })

  it('renders no row when the allowance is known but the draw on it is not', () => {
    const quota = decodeCodexUsage({ spend_control: { individual_limit: { limit: 10_000, reset_at: 1_785_542_400 } } })
    expect(quota.primary).toBeNull()
    expect(quota.details).toEqual([])
  })

  it('treats a blank numeric string as absent, not as zero', () => {
    const quota = decodeCodexUsage({ spend_control: { individual_limit: { limit: '10000', used: '  ', used_percent: 30 } } })
    expect(quota.primary?.label).toBe('Monthly usage limit · 3,000 / 10,000 credits')
    expect(decodeCodexUsage({ spend_control: { individual_limit: { limit: '' } } }).primary).toBeNull()
  })

  it('marks a spent-out allowance as reached', () => {
    const quota = decodeCodexUsage({
      spend_control: { reached: true, individual_limit: { limit: 10_000, used: 10_000, used_percent: 100 } },
    })
    expect(quota.primary?.label).toBe('Monthly usage limit · 10,000 / 10,000 credits · limit reached')
    expect(quota.primary?.percent).toBe(1)
  })

  it('keeps overage counts truthful while clamping the bar', () => {
    const quota = decodeCodexUsage({ spend_control: { individual_limit: { limit: 10_000, used: 12_000, used_percent: 120 } } })
    expect(quota.primary?.label).toBe('Monthly usage limit · 12,000 / 10,000 credits')
    expect(quota.primary?.percent).toBe(1)
  })

  it('keeps the implied overage when only the percent is given', () => {
    const quota = decodeCodexUsage({ spend_control: { individual_limit: { limit: 10_000, used_percent: 120 } } })
    expect(quota.primary?.label).toBe('Monthly usage limit · 12,000 / 10,000 credits')
    expect(quota.primary?.percent).toBe(1)
  })

  it('skips a garbage alias instead of letting it mask a valid one', () => {
    const quota = decodeCodexUsage({
      spend_control: { individual_limit: 'bad', individualLimit: { limit: 100, usedPercent: 25 } },
    })
    expect(quota.primary?.label).toBe('Monthly usage limit · 25 / 100 credits')
    const perField = decodeCodexUsage({
      spend_control: { individual_limit: { limit: 100, used_percent: 'bad', usedPercent: 25 } },
    })
    expect(perField.primary?.percent).toBe(0.25)
  })

  it('survives a reset timestamp beyond the Date range', () => {
    const quota = decodeCodexUsage({ spend_control: { individual_limit: { limit: 100, used_percent: 10, reset_at: 9_000_000_000_000 } } })
    expect(quota.primary?.resetsAt).toBeNull()
    expect(quota.primary?.percent).toBe(0.1)
  })

  it('says so when the account is credit-metered but uncapped', () => {
    const quota = decodeCodexUsage({ plan_type: 'business', credits: { has_credits: true, unlimited: true } })
    expect(quota.footerLines).toEqual(['Credits · Unlimited'])
    const capped = decodeCodexUsage({ credits: { unlimited: true }, spend_control: { individual_limit: { limit: 10_000, used_percent: 30 } } })
    expect(capped.footerLines).toEqual([])
  })

  it('normalizes credit-based-pricing plan tiers', () => {
    const label = (plan_type: string) => decodeCodexUsage({ plan_type }).planLabel
    expect(label('enterprise_cbp_usage_based')).toBe('Enterprise')
    expect(label('self_serve_business_usage_based')).toBe('Business')
    expect(label('enterprise')).toBe('Enterprise')
    expect(label('some_future_tier')).toBe('Some Future Tier')
  })

  it('labels a credit-settled balance in credits, not dollars', () => {
    const inCredits = decodeCodexUsage({ credits: { has_credits: true, balance: 3410.4 } })
    expect(inCredits.footerLines).toEqual(['Credits remaining · 3,410'])
    const inDollars = decodeCodexUsage({ credits: { has_credits: false, balance: 3.5 } })
    expect(inDollars.footerLines).toEqual(['Credits remaining · $3.50'])
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
    expect(usageInit.headers).toMatchObject({ 'ChatGPT-Account-Id': 'acct_1', 'User-Agent': 'CodeBurn' })
  })

  it('refreshes after eight days and preserves unrelated auth keys on write-back', async () => {
    const stale = { ...auth, last_refresh: '2026-07-01T00:00:00Z' }
    const fetchMock = vi.fn(async (url: string) => url.includes('/oauth/token')
      ? new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'new-id' }), { status: 200 })
      : new Response(JSON.stringify({ plan_type: 'pro', rate_limit: {} }), { status: 200 }))
    const writeFile = vi.fn(async () => undefined)
    await fetchCodexQuota({ fetch: fetchMock as typeof fetch, readFile: vi.fn(async () => JSON.stringify(stale)), writeFile, now: () => now })
    const saved = JSON.parse((writeFile.mock.calls[0]! as unknown as [string, string])[1])
    expect(saved.OPENAI_API_KEY).toBe('preserve-me')
    expect(saved.tokens).toMatchObject({ access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'new-id', account_id: 'acct_1' })
    expect((fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1].method).toBe('POST')
  })
})

// The CodeBurn menubar caches its Codex OAuth as a Swift CredentialRecord blob.
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
    const writeFile = vi.fn(async () => undefined)
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => null), writeFile, keychain, allowKeychain: true })
    expect(result.quota.connection).toBe('connected')
    expect(result.quota.planLabel).toBe('Pro')
    const init = (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer eyJmenubar.token.sig', 'ChatGPT-Account-Id': 'acct_mb' })
    expect(writeFile).not.toHaveBeenCalled()
    expect(keychain).toHaveBeenCalledWith('org.agentseal.codeburn.menubar.codex.oauth.v1')
  })

  it('re-reads the keychain once on a 401 and adopts a rotated token, never a refresh POST', async () => {
    const rotated = JSON.stringify({ accessToken: 'eyJrotated.token.sig', refreshToken: 'mb-refresh2', idToken: 'mb-id', accountId: 'acct_mb' })
    let reads = 0
    const keychain = vi.fn(async () => ({ status: 'found' as const, value: reads++ === 0 ? menubarRecord : rotated }))
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.headers as Record<string, string>).Authorization === 'Bearer eyJrotated.token.sig'
      ? new Response(JSON.stringify({ plan_type: 'pro', rate_limit: {} }), { status: 200 })
      : new Response('', { status: 401 }))
    const writeFile = vi.fn(async () => undefined)
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => null), writeFile, keychain, allowKeychain: true })
    expect(result.quota.connection).toBe('connected')
    expect(fetchMock.mock.calls.every(call => String(call[0]).includes('/wham/usage'))).toBe(true)
    expect(keychain).toHaveBeenCalledTimes(2)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('returns transientFailure on a keychain 401 with no rotation, never writing back', async () => {
    const keychain = vi.fn(async () => ({ status: 'found' as const, value: menubarRecord }))
    const fetchMock = vi.fn(async (_url: string) => new Response('', { status: 401 }))
    const writeFile = vi.fn(async () => undefined)
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => null), writeFile, keychain, allowKeychain: true })
    expect(result.quota.connection).toBe('transientFailure')
    expect(fetchMock.mock.calls.every(call => String(call[0]).includes('/wham/usage'))).toBe(true)
    expect(writeFile).not.toHaveBeenCalled()
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
    const writeFile = vi.fn(async () => undefined)
    const result = await fetchCodexQuota({ fetch: fetchMock as unknown as typeof fetch, readFile: vi.fn(async () => JSON.stringify(auth)), writeFile, keychain, allowKeychain: true, now: () => now })
    expect(result.quota.connection).toBe('connected')
    const init = (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer eyJmenubar.token.sig' })
    expect(writeFile).not.toHaveBeenCalled()
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
