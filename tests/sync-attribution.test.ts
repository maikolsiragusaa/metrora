/**
 * Tests for sync git attribution (sync push --attribution).
 *
 * Covers: remote URL normalization, session→commit attribution record
 * computation (reusing the yield engine), state-encoding dedup keys,
 * attribution OTLP span construction, and the send/ledger pipeline.
 */

import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { ProjectSummary, SessionSummary } from '../src/types.js'
import {
  normalizeRemoteUrl,
  computeAttributionRecords,
  sanitizePrLinks,
  MAX_PR_LINKS_PER_SESSION,
  type SessionAttributionRecord,
} from '../src/yield.js'
import {
  flattenAttributionRecords,
  commitAttributionKey,
  sessionAttributionKey,
  buildAttributionOtlpPayload,
  batchAttributionItems,
  deriveTraceId,
  SESSION_ATTRIBUTION_SPAN_NAME,
  COMMIT_ATTRIBUTION_SPAN_NAME,
  type OtlpAttribute,
} from '../src/sync/otlp.js'

// ── Git fixtures (mirrors yield-repo-grouping.test.ts) ────────────────

function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  }).trim()
}

function initRepo(dir: string): void {
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
}

function commitAt(dir: string, message: string, iso: string): void {
  git(dir, ['add', '.'])
  git(dir, ['commit', '-m', message], {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  })
}

function makeSession(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: 'session',
    project: 'app',
    firstTimestamp: '2026-01-01T10:00:00.000Z',
    lastTimestamp: '2026-01-01T11:00:00.000Z',
    totalCostUSD: 1,
    totalSavingsUSD: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    apiCalls: 1,
    turns: [],
    modelBreakdown: {},
    toolBreakdown: {},
    mcpBreakdown: {},
    bashBreakdown: {},
    categoryBreakdown: {} as SessionSummary['categoryBreakdown'],
    skillBreakdown: {},
    subagentBreakdown: {},
    ...overrides,
  }
}

const range = {
  start: new Date('2026-01-01T00:00:00.000Z'),
  end: new Date('2026-01-02T00:00:00.000Z'),
}

// ── normalizeRemoteUrl ────────────────────────────────────────────────

describe('normalizeRemoteUrl', () => {
  it('normalizes scp-like ssh remotes', () => {
    expect(normalizeRemoteUrl('git@github.com:acme/widget.git')).toBe('github.com/acme/widget')
    expect(normalizeRemoteUrl('git@GitHub.com:Acme/Widget')).toBe('github.com/Acme/Widget')
  })

  it('normalizes ssh:// remotes, dropping user and port', () => {
    expect(normalizeRemoteUrl('ssh://git@github.com/acme/widget.git')).toBe('github.com/acme/widget')
    expect(normalizeRemoteUrl('ssh://git@gitlab.example.com:2222/group/sub/repo.git')).toBe('gitlab.example.com/group/sub/repo')
  })

  it('normalizes https remotes and strips embedded credentials', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/widget.git')).toBe('github.com/acme/widget')
    expect(normalizeRemoteUrl('https://user:s3cret-token@github.com/acme/widget.git')).toBe('github.com/acme/widget')
    expect(normalizeRemoteUrl('https://github.com/acme/widget/')).toBe('github.com/acme/widget')
  })

  it('returns null for local paths and file:// remotes', () => {
    expect(normalizeRemoteUrl('/home/dev/repos/widget')).toBeNull()
    expect(normalizeRemoteUrl('file:///home/dev/repos/widget')).toBeNull()
    expect(normalizeRemoteUrl('../relative/repo')).toBeNull()
    expect(normalizeRemoteUrl('')).toBeNull()
  })

  it('rejects Windows drive-letter paths (never a remote identity)', () => {
    expect(normalizeRemoteUrl('C:/Users/alice/private/repo')).toBeNull()
    expect(normalizeRemoteUrl('C:\\Users\\alice\\private\\repo')).toBeNull()
    expect(normalizeRemoteUrl('c:/repo')).toBeNull()
    expect(normalizeRemoteUrl('Z:\\work\\nda-client-repo')).toBeNull()
    // Drive-relative (no slash after colon) — single-char host rejection
    expect(normalizeRemoteUrl('C:repo')).toBeNull()
    expect(normalizeRemoteUrl('c:relative\\path')).toBeNull()
  })

  it('rejects other adversarial forms without over-rejecting real remotes', () => {
    // Single-character "host" is never a real remote host
    expect(normalizeRemoteUrl('a:path/to/repo')).toBeNull()
    expect(normalizeRemoteUrl('git@C:/foo')).toBeNull()
    // Dotless intranet hosts remain valid (2+ chars)
    expect(normalizeRemoteUrl('gitserver:team/repo.git')).toBe('gitserver/team/repo')
    expect(normalizeRemoteUrl('git@gitbox:org/repo.git')).toBe('gitbox/org/repo')
  })
})

// ── computeAttributionRecords ─────────────────────────────────────────

describe('computeAttributionRecords', () => {
  it('attributes commits with normalized remote, inMain, and timestamps', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'codeburn-attr-repo-'))
    try {
      initRepo(repoDir)
      git(repoDir, ['remote', 'add', 'origin', 'git@github.com:acme/widget.git'])
      await writeFile(join(repoDir, 'file.txt'), 'hello\n')
      commitAt(repoDir, 'feat: shipped', '2026-01-01T10:30:00Z')
      const sha = git(repoDir, ['rev-parse', 'HEAD'])

      const session = makeSession({
        sessionId: 'sess-a',
        prLinks: ['https://github.com/acme/widget/pull/12'],
      })
      const projects = [
        { project: 'app', projectPath: repoDir, sessions: [session] } as ProjectSummary,
      ]

      const records = computeAttributionRecords(projects, range, repoDir)

      expect(records).toHaveLength(1)
      const record = records[0]!
      expect(record.sessionId).toBe('sess-a')
      expect(record.repo).toBe('github.com/acme/widget')
      expect(record.prLinks).toEqual(['https://github.com/acme/widget/pull/12'])
      expect(record.commits).toHaveLength(1)
      expect(record.commits[0]).toMatchObject({ sha, inMain: true, wasReverted: false })
      expect(new Date(record.commits[0]!.timestamp).toISOString()).toBe('2026-01-01T10:30:00.000Z')
      expect(record.firstTimestamp).toBe('2026-01-01T10:00:00.000Z')
      expect(record.lastTimestamp).toBe('2026-01-01T11:00:00.000Z')
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('omits sessions with no commits and no PR links', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'codeburn-attr-empty-'))
    try {
      initRepo(repoDir)
      git(repoDir, ['remote', 'add', 'origin', 'git@github.com:acme/widget.git'])
      await writeFile(join(repoDir, 'file.txt'), 'hello\n')
      // Commit outside every session window
      commitAt(repoDir, 'feat: unrelated', '2026-01-01T20:00:00Z')

      const session = makeSession({ sessionId: 'sess-idle' })
      const projects = [
        { project: 'app', projectPath: repoDir, sessions: [session] } as ProjectSummary,
      ]

      expect(computeAttributionRecords(projects, range, repoDir)).toEqual([])
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('drops commits when the repo has no remote, but keeps PR-linked sessions', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'codeburn-attr-noremote-'))
    try {
      initRepo(repoDir) // no origin remote
      await writeFile(join(repoDir, 'file.txt'), 'hello\n')
      commitAt(repoDir, 'feat: local only', '2026-01-01T10:30:00Z')

      const withPr = makeSession({
        sessionId: 'sess-pr',
        prLinks: ['https://github.com/acme/widget/pull/7'],
        firstTimestamp: '2026-01-01T10:15:00.000Z',
        lastTimestamp: '2026-01-01T10:45:00.000Z',
      })
      const withoutPr = makeSession({ sessionId: 'sess-nopr' })
      const projects = [
        { project: 'app', projectPath: repoDir, sessions: [withPr, withoutPr] } as ProjectSummary,
      ]

      const records = computeAttributionRecords(projects, range, repoDir)

      // sess-pr wins the commit window but has no repo identity, so commits
      // are dropped; the PR link alone justifies the record. sess-nopr has
      // nothing joinable and is omitted.
      expect(records).toHaveLength(1)
      expect(records[0]!.sessionId).toBe('sess-pr')
      expect(records[0]!.repo).toBeNull()
      expect(records[0]!.commits).toEqual([])
      expect(records[0]!.prLinks).toEqual(['https://github.com/acme/widget/pull/7'])
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('never egresses the cwd repo for sessions whose project path did not resolve (fallback)', async () => {
    // The reviewer's repro: push from inside a private repo while a session's
    // project path no longer resolves. The fallback identity must NOT leak
    // the cwd repo's remote or commits into that session's attribution.
    const cwdRepo = await mkdtemp(join(tmpdir(), 'codeburn-attr-privatecwd-'))
    try {
      initRepo(cwdRepo)
      git(cwdRepo, ['remote', 'add', 'origin', 'git@github.com:secret-org/nda-client-repo.git'])
      await writeFile(join(cwdRepo, 'file.txt'), 'confidential\n')
      commitAt(cwdRepo, 'feat: private work', '2026-01-01T10:30:00Z')

      // Session A: project path is gone (deleted dir) — falls back to cwd
      const orphanNoPr = makeSession({ sessionId: 'orphan-nopr', ...{ firstTimestamp: '2026-01-01T10:15:00.000Z', lastTimestamp: '2026-01-01T10:45:00.000Z' } })
      // Session B: also fallback, but carries a PR link (session-native, safe)
      const orphanWithPr = makeSession({
        sessionId: 'orphan-pr',
        prLinks: ['https://github.com/acme/widget/pull/9'],
        firstTimestamp: '2026-01-01T12:00:00.000Z',
        lastTimestamp: '2026-01-01T12:30:00.000Z',
      })
      // Session C: genuinely belongs to the cwd repo (own path resolves)
      const genuine = makeSession({ sessionId: 'genuine-cwd', firstTimestamp: '2026-01-01T10:00:00.000Z', lastTimestamp: '2026-01-01T11:00:00.000Z' })

      const projects = [
        { project: 'ghost', projectPath: join(cwdRepo, 'no-such-dir-anymore-xyz'), sessions: [orphanNoPr] },
        { project: 'ghost2', projectPath: '', sessions: [orphanWithPr] },
        { project: 'real', projectPath: cwdRepo, sessions: [genuine] },
      ] as ProjectSummary[]

      const records = computeAttributionRecords(projects, range, cwdRepo)

      // orphan-nopr: nothing joinable -> no record at all
      expect(records.find(r => r.sessionId === 'orphan-nopr')).toBeUndefined()
      // orphan-pr: PR link only — no repo, no commits
      const pr = records.find(r => r.sessionId === 'orphan-pr')!
      expect(pr.repo).toBeNull()
      expect(pr.commits).toEqual([])
      // genuine cwd session keeps full attribution
      const own = records.find(r => r.sessionId === 'genuine-cwd')!
      expect(own.repo).toBe('github.com/secret-org/nda-client-repo')
      expect(own.commits).toHaveLength(1)
      // The private repo identity appears ONLY on the genuine record
      const leaked = records.filter(r => r.sessionId !== 'genuine-cwd' && JSON.stringify(r).includes('secret-org'))
      expect(leaked).toEqual([])
    } finally {
      await rm(cwdRepo, { recursive: true, force: true })
    }
  })

  it('fallback sessions cannot steal a commit from a genuine session', async () => {
    const cwdRepo = await mkdtemp(join(tmpdir(), 'codeburn-attr-steal-'))
    try {
      initRepo(cwdRepo)
      git(cwdRepo, ['remote', 'add', 'origin', 'git@github.com:acme/widget.git'])
      await writeFile(join(cwdRepo, 'file.txt'), 'x\n')
      commitAt(cwdRepo, 'feat: mine', '2026-01-01T10:30:00Z')

      // Fallback session has the TIGHTER window (would win under old logic);
      // genuine session has the broader window.
      const fallbackTight = makeSession({
        sessionId: 'fallback-tight',
        prLinks: ['https://github.com/acme/widget/pull/2'],
        firstTimestamp: '2026-01-01T10:25:00.000Z',
        lastTimestamp: '2026-01-01T10:35:00.000Z',
      })
      const genuineBroad = makeSession({ sessionId: 'genuine-broad' })

      const projects = [
        { project: 'ghost', projectPath: '', sessions: [fallbackTight] },
        { project: 'real', projectPath: cwdRepo, sessions: [genuineBroad] },
      ] as ProjectSummary[]

      const records = computeAttributionRecords(projects, range, cwdRepo)

      expect(records.find(r => r.sessionId === 'fallback-tight')!.commits).toEqual([])
      expect(records.find(r => r.sessionId === 'genuine-broad')!.commits).toHaveLength(1)
    } finally {
      await rm(cwdRepo, { recursive: true, force: true })
    }
  })

  it('awards each commit to a single session (tightest window)', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'codeburn-attr-overlap-'))
    try {
      initRepo(repoDir)
      git(repoDir, ['remote', 'add', 'origin', 'https://github.com/acme/widget.git'])
      await writeFile(join(repoDir, 'file.txt'), 'hello\n')
      commitAt(repoDir, 'feat: shared window', '2026-01-01T10:30:00Z')

      const tight = makeSession({
        sessionId: 'sess-tight',
        firstTimestamp: '2026-01-01T10:15:00.000Z',
        lastTimestamp: '2026-01-01T10:45:00.000Z',
      })
      const broad = makeSession({ sessionId: 'sess-broad' })
      const projects = [
        { project: 'app', projectPath: repoDir, sessions: [tight, broad] } as ProjectSummary,
      ]

      const records = computeAttributionRecords(projects, range, repoDir)

      expect(records).toHaveLength(1)
      expect(records[0]!.sessionId).toBe('sess-tight')
      expect(records[0]!.commits).toHaveLength(1)
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })
})

// ── Dedup keys and flattening ─────────────────────────────────────────

function makeRecord(overrides: Partial<SessionAttributionRecord> = {}): SessionAttributionRecord {
  return {
    sessionId: 'sess-1',
    project: 'app',
    repo: 'github.com/acme/widget',
    prLinks: ['https://github.com/acme/widget/pull/3'],
    commits: [
      { sha: 'a'.repeat(40), timestamp: '2026-01-01T10:30:00.000Z', inMain: true, wasReverted: false },
    ],
    firstTimestamp: '2026-01-01T10:00:00.000Z',
    lastTimestamp: '2026-01-01T11:00:00.000Z',
    ...overrides,
  }
}

describe('attribution dedup keys', () => {
  it('encodes commit state so a state transition mints a new key', () => {
    const before = commitAttributionKey('sess-1', 'abc123', false, false)
    const merged = commitAttributionKey('sess-1', 'abc123', true, false)
    const reverted = commitAttributionKey('sess-1', 'abc123', true, true)
    expect(new Set([before, merged, reverted]).size).toBe(3)
    // Same state = same key (ledger dedupes repeats)
    expect(commitAttributionKey('sess-1', 'abc123', true, false)).toBe(merged)
  })

  it('session key is stable for identical state and changes with commit state', () => {
    const record = makeRecord()
    expect(sessionAttributionKey(record)).toBe(sessionAttributionKey(makeRecord()))

    const mutated = makeRecord({
      commits: [{ sha: 'a'.repeat(40), timestamp: '2026-01-01T10:30:00.000Z', inMain: true, wasReverted: true }],
    })
    expect(sessionAttributionKey(mutated)).not.toBe(sessionAttributionKey(record))
  })

  it('flattens one session item plus one item per commit', () => {
    const items = flattenAttributionRecords([makeRecord()])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'session', commitCount: 1, endTimestamp: '2026-01-01T11:00:00.000Z' })
    expect(items[1]).toMatchObject({ kind: 'commit', sha: 'a'.repeat(40), inMain: true, wasReverted: false })
    expect(items.map(i => i.dedupKey)).toEqual([
      sessionAttributionKey(makeRecord()),
      commitAttributionKey('sess-1', 'a'.repeat(40), true, false),
    ])
  })
})

// ── PR link sanitization ──────────────────────────────────────────────

describe('sanitizePrLinks', () => {
  it('keeps only https URLs shaped like org/repo/pull/N', () => {
    expect(sanitizePrLinks([
      'https://github.com/acme/widget/pull/12',
      'https://ghe.corp.example.com/team/svc/pull/3',   // GHE hosts allowed
      'http://github.com/acme/widget/pull/12',          // not https
      'javascript:alert(1)',                            // not a URL shape we accept
      'https://github.com/acme/widget/issues/12',       // not a PR path
      'https://github.com/acme/widget/pull/12/files',   // extra path segment
      'not a url at all',
      '',
      'https://github.com/acme/widget/pull/notanumber',
    ])).toEqual([
      'https://ghe.corp.example.com/team/svc/pull/3',
      'https://github.com/acme/widget/pull/12',
    ])
  })

  it('drops oversized strings and caps the count per session', () => {
    const huge = `https://github.com/acme/widget/pull/1?x=${'a'.repeat(300)}`
    expect(sanitizePrLinks([huge])).toEqual([])

    const many = Array.from({ length: 30 }, (_, i) => `https://github.com/acme/widget/pull/${i + 1}`)
    expect(sanitizePrLinks(many)).toHaveLength(MAX_PR_LINKS_PER_SESSION)
  })
})

// ── OTLP payload ──────────────────────────────────────────────────────

function attrMap(attributes: OtlpAttribute[]): Record<string, unknown> {
  return Object.fromEntries(attributes.map(a => [a.key, a.value]))
}

describe('buildAttributionOtlpPayload', () => {
  it('builds session and commit spans sharing the session traceId', () => {
    const items = flattenAttributionRecords([makeRecord()])
    const payload = buildAttributionOtlpPayload(items)

    const resource = payload.resourceSpans[0]!
    const resourceAttrs = attrMap(resource.resource.attributes)
    expect(resourceAttrs['codeburn.attribution_methodology']).toEqual({ stringValue: 'timestamp-window' })
    expect(resourceAttrs['codeburn.device_id']).toBeDefined()

    const spans = resource.scopeSpans[0]!.spans
    expect(spans).toHaveLength(2)

    const sessionSpan = spans.find(s => s.name === SESSION_ATTRIBUTION_SPAN_NAME)!
    const commitSpan = spans.find(s => s.name === COMMIT_ATTRIBUTION_SPAN_NAME)!
    expect(sessionSpan.traceId).toBe(deriveTraceId('sess-1'))
    expect(commitSpan.traceId).toBe(deriveTraceId('sess-1'))
    expect(sessionSpan.spanId).not.toBe(commitSpan.spanId)

    const sessionAttrs = attrMap(sessionSpan.attributes)
    expect(sessionAttrs['ai.session_id']).toEqual({ stringValue: 'sess-1' })
    expect(sessionAttrs['ai.project']).toEqual({ stringValue: 'app' })
    expect(sessionAttrs['git.repo']).toEqual({ stringValue: 'github.com/acme/widget' })
    expect(sessionAttrs['git.commit_count']).toEqual({ intValue: '1' })
    expect(sessionAttrs['git.pr_links']).toEqual({
      arrayValue: { values: [{ stringValue: 'https://github.com/acme/widget/pull/3' }] },
    })
    // Session span carries the real window as its duration
    expect(sessionSpan.startTimeUnixNano).toBe((BigInt(new Date('2026-01-01T10:00:00.000Z').getTime()) * 1_000_000n).toString())
    expect(sessionSpan.endTimeUnixNano).toBe((BigInt(new Date('2026-01-01T11:00:00.000Z').getTime()) * 1_000_000n).toString())

    const commitAttrs = attrMap(commitSpan.attributes)
    expect(commitAttrs['git.sha']).toEqual({ stringValue: 'a'.repeat(40) })
    expect(commitAttrs['git.in_main']).toEqual({ boolValue: true })
    expect(commitAttrs['git.was_reverted']).toEqual({ boolValue: false })
    expect(commitAttrs['git.repo']).toEqual({ stringValue: 'github.com/acme/widget' })
  })

  it('omits git.repo when null and pr_links when empty', () => {
    const items = flattenAttributionRecords([makeRecord({ repo: null, prLinks: [], commits: [] })])
    const payload = buildAttributionOtlpPayload(items)
    const spans = payload.resourceSpans[0]!.scopeSpans[0]!.spans
    expect(spans).toHaveLength(1)
    const attrs = attrMap(spans[0]!.attributes)
    expect(attrs['git.repo']).toBeUndefined()
    expect(attrs['git.pr_links']).toBeUndefined()
    expect(attrs['git.commit_count']).toEqual({ intValue: '0' })
  })

  it('batches items by maxBatchSize', () => {
    const items = flattenAttributionRecords([makeRecord(), makeRecord({ sessionId: 'sess-2' })])
    expect(batchAttributionItems(items, 3).map(b => b.length)).toEqual([3, 1])
  })
})

// ── Send + ledger pipeline ────────────────────────────────────────────

type MockResponse = { status: number; body?: unknown; headers?: Record<string, string> }

function startMockOtlp(responses: MockResponse[]): Promise<{
  url: string
  server: Server
  requests: Array<{ auth: string | undefined; body: unknown }>
}> {
  const requests: Array<{ auth: string | undefined; body: unknown }> = []
  let idx = 0

  return new Promise(resolve => {
    const server = createServer((req, res) => {
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', () => {
        requests.push({ auth: req.headers.authorization, body: JSON.parse(raw || '{}') })
        const r = responses[Math.min(idx, responses.length - 1)]!
        idx++
        res.writeHead(r.status, { 'Content-Type': 'application/json', ...r.headers })
        res.end(r.body !== undefined ? JSON.stringify(r.body) : '{}')
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${addr.port}/v1/traces`, server, requests })
    })
  })
}

let tmpDir: string
const originalHome = process.env.HOME
const originalXdgCache = process.env.XDG_CACHE_HOME

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'codeburn-attr-push-'))
  process.env.HOME = tmpDir
  process.env.XDG_CACHE_HOME = join(tmpDir, '.cache')
})

afterEach(async () => {
  process.env.HOME = originalHome
  if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = originalXdgCache
  await rm(tmpDir, { recursive: true, force: true })
})

describe('sendAttributionBatches + collectUnsentAttribution', () => {
  it('sends attribution spans, ledgers dedup keys, and filters them on the next collect', async () => {
    const { sendAttributionBatches, collectUnsentAttribution } = await import('../src/sync/push.js')
    const { readLedger } = await import('../src/sync/ledger.js')

    const record = makeRecord()
    const first = collectUnsentAttribution([record])
    expect(first.unsent).toHaveLength(2)

    const mock = await startMockOtlp([{ status: 200 }])
    try {
      const result = await sendAttributionBatches({
        endpoint: mock.url,
        accessToken: 'token-1',
        batches: [first.unsent],
      })

      expect(result.outcome).toBe('complete')
      expect(result.totalSent).toBe(2)
      expect(result.totalCostSent).toBe(0)
      expect(mock.requests).toHaveLength(1)
      expect(mock.requests[0]!.auth).toBe('Bearer token-1')

      const body = mock.requests[0]!.body as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string }> }> }> }
      const names = body.resourceSpans[0]!.scopeSpans[0]!.spans.map(s => s.name).sort()
      expect(names).toEqual([COMMIT_ATTRIBUTION_SPAN_NAME, SESSION_ATTRIBUTION_SPAN_NAME])

      const ledgered = readLedger().map(e => e.key).sort()
      expect(ledgered).toEqual(first.unsent.map(i => i.dedupKey).sort())

      // Identical state on the next push: nothing unsent
      expect(collectUnsentAttribution([record]).unsent).toEqual([])

      // State transition (commit reverted): the changed facts re-send
      const mutated = makeRecord({
        commits: [{ sha: 'a'.repeat(40), timestamp: '2026-01-01T10:30:00.000Z', inMain: true, wasReverted: true }],
      })
      const after = collectUnsentAttribution([mutated])
      expect(after.unsent.map(i => i.kind).sort()).toEqual(['commit', 'session'])
    } finally {
      mock.server.close()
    }
  })

  it('does not ledger on server error', async () => {
    const { sendAttributionBatches } = await import('../src/sync/push.js')
    const { readLedger } = await import('../src/sync/ledger.js')

    const items = flattenAttributionRecords([makeRecord()])
    const mock = await startMockOtlp([{ status: 500 }])
    try {
      const result = await sendAttributionBatches({
        endpoint: mock.url,
        accessToken: 'token-1',
        batches: [items],
      })
      expect(result.outcome).toBe('server-error')
      expect(readLedger()).toEqual([])
    } finally {
      mock.server.close()
    }
  })
})
