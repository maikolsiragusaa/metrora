import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { journalPath } from '../src/optimization-operations/journal.js'
import { captureBaseline, computeOptimizationReport } from '../src/optimization-operations/report.js'
import type { ActionRecord } from '../src/optimization-operations/types.js'
import type { McpServerCoverage, WasteFinding } from '../src/optimize.js'
import type { ProjectSummary } from '../src/types.js'

type Session = ProjectSummary['sessions'][number]

const roots: string[] = []
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }) })

const NOW = new Date('2026-08-07T12:00:00Z')
const DAY_MS = 86_400_000

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString()
}

async function writeJournal(records: ActionRecord[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-defer-report-'))
  roots.push(root)
  const actionsDir = join(root, 'actions')
  await mkdir(actionsDir, { recursive: true })
  await writeFile(journalPath(actionsDir), records.map(record => JSON.stringify(record)).join('\n') + '\n')
  return actionsDir
}

function session(id: string, active: boolean, server = 'everything'): Session {
  return {
    sessionId: id,
    project: 'app',
    firstTimestamp: daysAgo(5),
    lastTimestamp: daysAgo(5),
    totalCostUSD: 1,
    totalSavingsUSD: 0,
    totalInputTokens: 1000,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    apiCalls: 1,
    turns: [],
    modelBreakdown: {},
    toolBreakdown: {},
    mcpBreakdown: active ? {} : { [server]: { calls: 1 } },
    bashBreakdown: {},
    categoryBreakdown: {} as Session['categoryBreakdown'],
    skillBreakdown: {},
    subagentBreakdown: {},
    ...(active ? { mcpInventory: [`mcp__${server}__sum`] } : {}),
  }
}

function project(sessions: Session[]): ProjectSummary {
  return {
    project: 'app',
    projectPath: '/tmp/app',
    sessions,
    totalCostUSD: sessions.length,
    totalSavingsUSD: 0,
    totalApiCalls: sessions.length,
    totalProxiedCostUSD: 0,
  }
}

function deferRecord(kind: ActionRecord['kind'] = 'defer-enable', metrics: Record<string, number> = { everything: 4000 }): ActionRecord {
  const at = daysAgo(10)
  return {
    id: `defer-${kind}`,
    at,
    kind,
    findingId: kind === 'defer-alwaysload' ? 'mcp-alwaysload-hygiene' : 'mcp-deferral-off',
    description: 'Restore MCP tool deferral',
    changes: [],
    status: 'applied',
    baseline: {
      windowDays: 14,
      capturedAt: at,
      estimatedTokens: 40_000,
      sessions: 5,
      metrics,
    },
  }
}

const load = (projects: ProjectSummary[]) => async () => projects

describe('optimization-actions report defer evidence', () => {
  it('counts only post-apply sessions where the parser observed deferral active', async () => {
    const actionsDir = await writeJournal([deferRecord()])
    const sessions = [session('a', true), session('b', true), session('c', true), session('d', false), session('e', false)]

    const report = await computeOptimizationReport({ actionsDir, now: NOW, loadProjects: load([project(sessions)]) })
    const row = report.rows[0]!

    expect(row.status).toBe('measured')
    expect(row.estimatedForWindow).toBe(20_000)
    expect(row.realizedTokens).toBe(12_000)
    expect(row.note).toMatch(/3\/5 post-apply sessions/)
    expect(report.totalRealizedTokens).toBe(12_000)
  })

  it('claims zero when no post-apply session shows deferral active', async () => {
    const actionsDir = await writeJournal([deferRecord()])
    const sessions = Array.from({ length: 5 }, (_, index) => session(`off-${index}`, false))

    const report = await computeOptimizationReport({ actionsDir, now: NOW, loadProjects: load([project(sessions)]) })
    const row = report.rows[0]!

    expect(row.status).toBe('reverted')
    expect(row.realizedTokens).toBe(0)
    expect(row.note).toMatch(/not yet observed/)
    expect(report.totalRealizedTokens).toBe(0)
  })

  it('requires the targeted server to be observed for defer-alwaysload', async () => {
    const record = deferRecord('defer-alwaysload', { 'heavy-server': 4800 })
    const actionsDir = await writeJournal([record])
    const sessions = [
      session('other-only', true, 'other-server'),
      session('target', true, 'heavy-server'),
      session('off', false, 'heavy-server'),
    ]

    const report = await computeOptimizationReport({ actionsDir, now: NOW, loadProjects: load([project(sessions)]) })
    const row = report.rows[0]!

    expect(row.status).toBe('measured')
    expect(row.estimatedForWindow).toBe(14_400)
    expect(row.realizedTokens).toBe(4_800)
    expect(row.note).toMatch(/targeted server deferral active in 1\/3/)
  })

  it('does not treat another deferred server as evidence for defer-alwaysload', async () => {
    const record = deferRecord('defer-alwaysload', { 'heavy-server': 4800 })
    const actionsDir = await writeJournal([record])
    const sessions = [session('other-a', true, 'other-server'), session('other-b', true, 'another-server')]

    const report = await computeOptimizationReport({ actionsDir, now: NOW, loadProjects: load([project(sessions)]) })
    const row = report.rows[0]!

    expect(row.status).toBe('reverted')
    expect(row.realizedTokens).toBe(0)
    expect(row.note).toMatch(/targeted server deferral remains inactive/)
  })

  it('remains not measurable when the action predates baseline capture support', async () => {
    const legacy = { ...deferRecord(), baseline: undefined }
    const actionsDir = await writeJournal([legacy])

    const report = await computeOptimizationReport({ actionsDir, now: NOW, loadProjects: load([project([session('active', true)])]) })
    expect(report.rows[0]!.status).toBe('not-measurable')
    expect(report.rows[0]!.note).toMatch(/no baseline captured/)
  })
})

describe('defer baseline capture', () => {
  const coverage: McpServerCoverage[] = [{
    server: 'heavy-server',
    toolsAvailable: 12,
    toolsInvoked: 1,
    unusedTools: Array.from({ length: 11 }, (_, index) => `mcp__heavy-server__unused-${index}`),
    invocations: 1,
    loadedSessions: 2,
    coverageRatio: 1 / 12,
  }]

  it('uses named server coverage for defer-alwaysload', () => {
    const finding = {
      id: 'mcp-alwaysload-hygiene',
      title: 'Always-load server',
      explanation: 'test',
      impact: 'medium',
      tokensSaved: 48_000,
      fix: { type: 'command', label: 'test', text: 'test' },
      apply: { kind: 'defer-alwaysload', servers: [{ server: 'heavy-server', paths: ['/tmp/settings.json'] }] },
    } satisfies WasteFinding

    const baseline = captureBaseline(finding, 'defer-alwaysload', {
      projects: [project([session('loading', false, 'heavy-server'), session('active', true, 'heavy-server')])],
      coverage,
      windowDays: 14,
      now: NOW,
    })

    expect(baseline).toMatchObject({
      estimatedTokens: 48_000,
      metrics: { 'heavy-server': 12 * 400 },
    })
  })

  it('derives whole-surface servers from observed MCP evidence for defer-enable', () => {
    const finding = {
      id: 'mcp-deferral-off',
      title: 'Deferral off',
      explanation: 'test',
      impact: 'high',
      tokensSaved: 20_000,
      fix: { type: 'command', label: 'test', text: 'test' },
      apply: { kind: 'defer-enable', cause: 'env-false' },
    } satisfies WasteFinding

    const baseline = captureBaseline(finding, 'defer-enable', {
      projects: [project([session('loading', false)])],
      coverage: [],
      windowDays: 14,
      now: NOW,
    })

    expect(baseline?.metrics).toEqual({ everything: 5 * 400 })
  })
})
