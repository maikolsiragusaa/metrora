import { describe, expect, it } from 'vitest'

import { correlateCrossProviderPrSessions, extractPrUrlsFromText, filterProjectsByDateRange } from '../src/parser.js'
import type { ClassifiedTurn, ParsedApiCall, ProjectSummary, SessionSummary } from '../src/types.js'

const A = 'https://github.com/maikolsiragusaa/metrora/pull/790'
const B = 'https://github.com/maikolsiragusaa/metrora/pull/791'

function call(provider: string, timestamp: string, command?: string): ParsedApiCall {
  return {
    provider, model: provider === 'claude' ? 'claude-opus-4-8' : 'gpt-5.6-terra',
    usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, webSearchRequests: 0 },
    costUSD: 1, tools: command ? ['Bash'] : [], mcpTools: [], skills: [], subagentTypes: [],
    hasAgentSpawn: false, hasPlanMode: false, speed: 'standard', timestamp,
    bashCommands: command ? ['codex'] : [], deduplicationKey: `${provider}:${timestamp}`,
    ...(command ? { toolSequence: [[{ tool: 'Bash', command }]] } : {}),
  }
}

function turn(provider: string, timestamp: string, userMessage: string, refs?: string[], command?: string): ClassifiedTurn {
  return {
    userMessage, timestamp, sessionId: `${provider}-${timestamp}`,
    assistantCalls: [call(provider, timestamp, command)], category: 'coding', retries: 0, hasEdits: false,
    ...(refs ? { prRefs: refs } : {}),
  }
}

function session(opts: { id: string; provider: string; timestamp: string; lastTimestamp?: string; message: string; refs?: string[]; cwd?: string; command?: string; parentId?: string; agentId?: string; gitBranch?: string }): SessionSummary {
  const turns = [turn(opts.provider, opts.timestamp, opts.message, opts.refs, opts.command)]
  if (opts.gitBranch) turns[0]!.gitBranch = opts.gitBranch
  return {
    sessionId: opts.id, project: 'metrora', firstTimestamp: opts.timestamp, lastTimestamp: opts.lastTimestamp ?? opts.timestamp,
    totalCostUSD: 1, totalSavingsUSD: 0, totalInputTokens: 1, totalOutputTokens: 1,
    totalReasoningTokens: 0, totalCacheReadTokens: 0, totalCacheWriteTokens: 0, apiCalls: 1, turns,
    modelBreakdown: {}, toolBreakdown: {}, mcpBreakdown: {}, bashBreakdown: {}, categoryBreakdown: {}, skillBreakdown: {}, subagentBreakdown: {},
    ...(opts.refs ? { prLinks: opts.refs, prAttributionSource: 'transcript' as const } : {}),
    ...(opts.cwd ? { workingDirectory: opts.cwd } : {}),
    ...(opts.parentId ? { parentSessionId: opts.parentId } : {}),
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
  }
}

function project(sessions: SessionSummary[]): ProjectSummary {
  return { project: 'metrora', projectPath: '/repo/metrora', sessions, totalCostUSD: sessions.length, totalSavingsUSD: 0, totalApiCalls: sessions.length, totalProxiedCostUSD: 0 }
}

describe('provider-neutral PR references', () => {
  it('extracts and deduplicates full GitHub PR URLs from any provider text', () => {
    expect(extractPrUrlsFromText(`review ${A}, then ${B}; duplicate ${A}`)).toEqual([A, B])
  })
})

describe('cross-provider PR correlation', () => {
  const prompt = 'Adversarial review of the cross-provider pull-request attribution implementation with concrete failure scenarios.'
  const cwd = '/repo/.claude/worktrees/agent-123'

  function evidence(id: string, refs: string[], timestamp: string, provider = 'claude'): SessionSummary {
    return session({ id, provider, timestamp, message: 'exact evidence', refs, cwd })
  }

  it('links an externally launched saved session by exact prompt evidence', () => {
    const parent = session({ id: 'claude', provider: 'claude', timestamp: '2026-07-21T00:00:00Z', message: 'launch review', refs: [B], command: `codex exec '${prompt}'` })
    const child = session({ id: 'codex', provider: 'codex', timestamp: '2026-07-21T00:00:05Z', message: prompt })
    correlateCrossProviderPrSessions([project([parent, child])])
    expect(child.prLinks).toEqual([B])
    expect(child.turns[0]!.prRefs).toEqual([B])
    expect(child.prAttributionSource).toBe('launcher-prompt')
  })

  it('does not use timestamp overlap without exact prompt evidence', () => {
    const parent = session({ id: 'claude', provider: 'claude', timestamp: '2026-07-21T00:00:00Z', message: 'launch review', refs: [B], command: `codex exec '${prompt}'` })
    const unrelated = session({ id: 'codex', provider: 'codex', timestamp: '2026-07-21T00:00:05Z', message: 'Investigate a completely unrelated production database incident and prepare a detailed report.' })
    correlateCrossProviderPrSessions([project([parent, unrelated])])
    expect(unrelated.prLinks).toBeUndefined()
  })

  it('bounds exact launcher-prompt evidence to plus or minus fifteen minutes', () => {
    const parent = session({ id: 'claude', provider: 'claude', timestamp: '2026-07-21T00:00:00Z', message: 'launch review', refs: [B], command: `codex exec '${prompt}'` })
    const before = session({ id: 'before', provider: 'codex', timestamp: '2026-07-20T23:44:59Z', message: prompt })
    const after = session({ id: 'after', provider: 'gemini', timestamp: '2026-07-21T00:15:01Z', message: prompt })
    correlateCrossProviderPrSessions([project([parent, before, after])])
    expect(before.prLinks).toBeUndefined()
    expect(after.prLinks).toBeUndefined()
  })

  it('does not treat a session-level PR union as active before its first turn ref', () => {
    const parent = session({ id: 'claude', provider: 'claude', timestamp: '2026-07-21T00:00:00Z', message: 'launch', refs: [A, B], command: `codex exec '${prompt}'` })
    delete parent.turns[0]!.prRefs
    const child = session({ id: 'codex', provider: 'codex', timestamp: '2026-07-21T00:00:05Z', message: prompt })
    correlateCrossProviderPrSessions([project([parent, child])])
    expect(child.prLinks).toBeUndefined()
  })

  it('links an exact shared cwd only when it resolves to one PR set', () => {
    const start = evidence('start', [B], '2026-07-21T00:00:00Z')
    const end = evidence('end', [B], '2026-07-21T02:00:00Z')
    const child = session({ id: 'gemini', provider: 'gemini', timestamp: '2026-07-21T01:00:00Z', message: 'short', cwd })
    correlateCrossProviderPrSessions([project([start, child, end])])
    expect(child.prLinks).toEqual([B])
    expect(child.prAttributionSource).toBe('working-directory')
  })

  it('leaves a shared cwd unattributed when two PRs used it', () => {
    const cwd = '/repo/metrora'
    const a = session({ id: 'a', provider: 'claude', timestamp: '2026-07-21T00:00:00Z', message: 'a', refs: [A], cwd })
    const b = session({ id: 'b', provider: 'claude', timestamp: '2026-07-21T01:00:00Z', message: 'b', refs: [B], cwd })
    const candidate = session({ id: 'c', provider: 'codex', timestamp: '2026-07-21T02:00:00Z', message: 'short', cwd })
    correlateCrossProviderPrSessions([project([a, b, candidate])])
    expect(candidate.prLinks).toBeUndefined()
  })

  it('uses Claude sidechain linkage as evidence without breaking its fold semantics', () => {
    const parent = session({ id: 'parent', provider: 'claude', timestamp: '2026-07-21T00:00:00Z', message: 'spawn', refs: [B] })
    parent.agentSpawnLinks = { child: 'spawn-1' }
    parent.spawnPrSets = { 'spawn-1': [B] }
    const child = session({ id: 'agent-child', provider: 'claude', timestamp: '2026-07-21T00:01:00Z', message: 'launch', command: `codex exec '${prompt}'`, parentId: 'parent', agentId: 'child' })
    const codex = session({ id: 'codex', provider: 'codex', timestamp: '2026-07-21T00:01:05Z', message: prompt })
    correlateCrossProviderPrSessions([project([parent, child, codex])])
    expect(child.prLinks).toBeUndefined()
    expect(codex.prLinks).toEqual([B])
    expect(codex.prAttributionSource).toBe('launcher-prompt')
  })

  it('preserves exact evidence even when cwd evidence is ambiguous', () => {
    const a0 = evidence('a0', [A], '2026-07-21T00:00:00Z')
    const a2 = evidence('a2', [A], '2026-07-21T02:00:00Z')
    const b0 = evidence('b0', [B], '2026-07-21T00:00:00Z')
    const b2 = evidence('b2', [B], '2026-07-21T02:00:00Z')
    const exact = session({ id: 'exact', provider: 'codex', timestamp: '2026-07-21T01:00:00Z', message: 'exact', refs: [A], cwd })
    correlateCrossProviderPrSessions([project([a0, a2, b0, b2, exact])])
    expect(exact.prLinks).toEqual([A])
    expect(exact.prAttributionSource).toBe('transcript')
  })

  it('lets launcher evidence beat conflicting cwd evidence', () => {
    const launch = session({ id: 'launch', provider: 'claude', timestamp: '2026-07-21T01:00:00Z', message: 'launch', refs: [B], command: `codex exec '${prompt}'` })
    const a0 = evidence('a0', [A], '2026-07-21T00:00:00Z')
    const a2 = evidence('a2', [A], '2026-07-21T02:00:00Z')
    const child = session({ id: 'child', provider: 'codex', timestamp: '2026-07-21T01:00:05Z', message: prompt, cwd })
    correlateCrossProviderPrSessions([project([a0, launch, child, a2])])
    expect(child.prLinks).toEqual([B])
    expect(child.prAttributionSource).toBe('launcher-prompt')
  })

  it('does not carry January Claude evidence into an August Codex session', () => {
    const claude = evidence('claude-january', [A], '2026-01-10T12:00:00Z')
    const codex = session({ id: 'codex-august', provider: 'codex', timestamp: '2026-08-10T12:00:00Z', message: 'short', cwd })
    correlateCrossProviderPrSessions([project([claude, codex])])
    expect(codex.prLinks).toBeUndefined()
  })

  it.each([
    ['branch reused', '2026-08-10T12:00:00Z', 'feature/reused'],
    ['checkout idle for days', '2026-01-20T12:00:00Z', undefined],
    ['detached HEAD', '2026-01-20T12:00:00Z', 'HEAD'],
  ])('fails closed for %s outside the observed envelope', (_label, timestamp, gitBranch) => {
    const old = evidence('old', [A], '2026-01-10T12:00:00Z')
    const candidate = session({ id: 'candidate', provider: 'codex', timestamp, message: 'short', cwd, ...(gitBranch ? { gitBranch } : {}) })
    correlateCrossProviderPrSessions([project([old, candidate])])
    expect(candidate.prLinks).toBeUndefined()
  })

  it('attributes the later PR after the same cwd moves to another PR', () => {
    const a0 = evidence('a0', [A], '2026-01-10T10:00:00Z')
    const a1 = evidence('a1', [A], '2026-01-10T11:00:00Z')
    const b0 = evidence('b0', [B], '2026-02-10T10:00:00Z')
    const b1 = evidence('b1', [B], '2026-02-10T11:00:00Z')
    const candidate = session({ id: 'candidate', provider: 'codex', timestamp: '2026-02-10T10:30:00Z', message: 'short', cwd })
    correlateCrossProviderPrSessions([project([a0, a1, b0, candidate, b1])])
    expect(candidate.prLinks).toEqual([B])
  })

  it.each([
    ['before first evidence', '2026-01-10T09:59:59Z'],
    ['after last evidence', '2026-01-10T11:00:01Z'],
  ])('does not attribute a session %s', (_label, timestamp) => {
    const start = evidence('start', [A], '2026-01-10T10:00:00Z')
    const end = evidence('end', [A], '2026-01-10T11:00:00Z')
    const candidate = session({ id: 'candidate', provider: 'codex', timestamp, message: 'short', cwd })
    correlateCrossProviderPrSessions([project([start, candidate, end])])
    expect(candidate.prLinks).toBeUndefined()
  })

  it.each([
    ['invalid', 'not-a-time', 'not-a-time'],
    ['missing', '', ''],
    ['inverted', '2026-01-10T10:30:00Z', '2026-01-10T10:29:59Z'],
  ])('fails closed for %s candidate timestamps', (_label, timestamp, lastTimestamp) => {
    const start = evidence('start', [A], '2026-01-10T10:00:00Z')
    const end = evidence('end', [A], '2026-01-10T11:00:00Z')
    const candidate = session({ id: 'candidate', provider: 'codex', timestamp, lastTimestamp, message: 'short', cwd })
    correlateCrossProviderPrSessions([project([start, candidate, end])])
    expect(candidate.prLinks).toBeUndefined()
  })

  it('fails closed when two PR evidence envelopes overlap', () => {
    const a0 = evidence('a0', [A], '2026-01-10T10:00:00Z')
    const a2 = evidence('a2', [A], '2026-01-10T12:00:00Z')
    const b0 = evidence('b0', [B], '2026-01-10T11:00:00Z')
    const b2 = evidence('b2', [B], '2026-01-10T13:00:00Z')
    const candidate = session({ id: 'candidate', provider: 'codex', timestamp: '2026-01-10T11:30:00Z', message: 'short', cwd })
    correlateCrossProviderPrSessions([project([a0, b0, candidate, a2, b2])])
    expect(candidate.prLinks).toBeUndefined()
  })

  it('is stable for warm reuse and a cold reconstructed graph', () => {
    const make = () => {
      const candidate = session({ id: 'candidate', provider: 'codex', timestamp: '2026-01-10T10:30:00Z', message: 'short', cwd })
      return { candidate, projects: [project([evidence('start', [A], '2026-01-10T10:00:00Z'), candidate, evidence('end', [A], '2026-01-10T11:00:00Z')])] }
    }
    const warm = make()
    correlateCrossProviderPrSessions(warm.projects)
    correlateCrossProviderPrSessions(warm.projects)
    const cold = make()
    correlateCrossProviderPrSessions(cold.projects)
    expect(warm.candidate.prLinks).toEqual([A])
    expect(cold.candidate.prLinks).toEqual([A])
  })

  it('rebuilds cwd attribution from new evidence instead of persisting derived truth', () => {
    const initialCandidate = session({ id: 'candidate', provider: 'codex', timestamp: '2026-01-10T10:30:00Z', message: 'short', cwd })
    correlateCrossProviderPrSessions([project([
      evidence('a-start', [A], '2026-01-10T10:00:00Z'), initialCandidate,
      evidence('a-end', [A], '2026-01-10T11:00:00Z'),
    ])])
    expect(initialCandidate.prLinks).toEqual([A])

    // A cold/cache-invalidated parse reconstructs sessions from persisted source
    // evidence. New overlapping evidence must make the cwd fallback ambiguous.
    const rebuiltCandidate = session({ id: 'candidate', provider: 'codex', timestamp: '2026-01-10T10:30:00Z', message: 'short', cwd })
    correlateCrossProviderPrSessions([project([
      evidence('a-start', [A], '2026-01-10T10:00:00Z'),
      evidence('b-start', [B], '2026-01-10T10:00:00Z'),
      rebuiltCandidate,
      evidence('a-end', [A], '2026-01-10T11:00:00Z'),
      evidence('b-end', [B], '2026-01-10T11:00:00Z'),
    ])])
    expect(rebuiltCandidate.prLinks).toBeUndefined()
  })

  it('does not retain out-of-range evidence after date slicing', () => {
    const old = evidence('old', [A], '2026-01-10T10:00:00Z')
    const candidate = session({ id: 'candidate', provider: 'codex', timestamp: '2026-08-10T10:00:00Z', message: 'short', cwd })
    const sliced = filterProjectsByDateRange([project([old, candidate])], {
      start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-31T23:59:59Z'),
    })
    correlateCrossProviderPrSessions(sliced)
    expect(sliced[0]!.sessions[0]!.prLinks).toBeUndefined()
  })
})
