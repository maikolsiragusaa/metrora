import { describe, expect, it } from 'vitest'

import type { DailyEntry, ProjectDayStats, ProviderDaySlice } from '../src/daily-cache.js'
import {
  UNATTRIBUTED_PROJECT_KEY,
  durableProjectDisplayName,
  reconcileDurableProjectDay,
  sliceDayToProvider,
} from '../src/durable-project-reconciliation.js'

function projectRecord(entries: Array<[string, ProjectDayStats]>): Record<string, ProjectDayStats> {
  const record = Object.create(null) as Record<string, ProjectDayStats>
  for (const [name, stats] of entries) {
    Object.defineProperty(record, name, {
      configurable: true,
      enumerable: true,
      value: stats,
      writable: true,
    })
  }
  return record
}

function providerRecord(entries: Array<[string, ProviderDaySlice]>): Record<string, ProviderDaySlice> {
  const record = Object.create(null) as Record<string, ProviderDaySlice>
  for (const [name, stats] of entries) {
    Object.defineProperty(record, name, {
      configurable: true,
      enumerable: true,
      value: stats,
      writable: true,
    })
  }
  return record
}

function fixtureDay(): DailyEntry {
  const projects = projectRecord([
    ['alpha', { cost: 60, calls: 6, savingsUSD: 6, sessions: 2, path: '/repo/alpha' }],
    ['beta', { cost: 30, calls: 3, savingsUSD: 3, sessions: 1, path: '/repo/beta' }],
  ])
  const claudeProjects = projectRecord([
    ['alpha', { cost: 50, calls: 5, savingsUSD: 5, sessions: 2, path: '/repo/alpha' }],
    ['beta', { cost: 20, calls: 2, savingsUSD: 2, sessions: 1, path: '/repo/beta' }],
  ])
  const codexProjects = projectRecord([
    ['alpha', { cost: 10, calls: 1, savingsUSD: 1, sessions: 1, path: '/repo/alpha' }],
    ['beta', { cost: 10, calls: 1, savingsUSD: 1, sessions: 1, path: '/repo/beta' }],
  ])
  return {
    date: '2026-07-01',
    cost: 100,
    savingsUSD: 10,
    calls: 10,
    sessions: 5,
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    editTurns: 4,
    oneShotTurns: 2,
    models: {
      model: {
        calls: 10,
        cost: 100,
        savingsUSD: 10,
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
      },
    },
    categories: {
      coding: { turns: 4, cost: 100, savingsUSD: 10, editTurns: 4, oneShotTurns: 2 },
    },
    providers: providerRecord([
      ['claude', {
        calls: 8,
        cost: 75,
        savingsUSD: 7.5,
        sessions: 4,
        inputTokens: 800,
        outputTokens: 400,
        cacheReadTokens: 160,
        cacheWriteTokens: 80,
        editTurns: 3,
        oneShotTurns: 2,
        models: {},
        categories: {},
        projects: claudeProjects,
      }],
      ['codex', {
        calls: 2,
        cost: 25,
        savingsUSD: 2.5,
        sessions: 2,
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 40,
        cacheWriteTokens: 20,
        editTurns: 1,
        oneShotTurns: 0,
        models: {},
        categories: {},
        projects: codexProjects,
      }],
    ]),
    projects,
    carried: true,
  }
}

describe('durable project reconciliation', () => {
  it('preserves every unfiltered total and materializes only the honest residual', () => {
    const source = fixtureDay()
    const projected = reconcileDurableProjectDay(source, {})

    expect(projected.cost).toBe(source.cost)
    expect(projected.calls).toBe(source.calls)
    expect(projected.sessions).toBe(source.sessions)
    expect(projected.inputTokens).toBe(source.inputTokens)
    expect(projected.models).toBe(source.models)
    expect(projected.carried).toBe(true)
    expect(projected.projects?.[UNATTRIBUTED_PROJECT_KEY]).toEqual({
      cost: 10,
      calls: 1,
      savingsUSD: 1,
      sessions: 2,
    })
    expect(projected.providers.claude?.projects?.[UNATTRIBUTED_PROJECT_KEY]).toEqual({
      cost: 5,
      calls: 1,
      savingsUSD: 0.5,
      sessions: 1,
    })
    expect(durableProjectDisplayName(UNATTRIBUTED_PROJECT_KEY)).toBe('Unattributed')
  })

  it('filters historical totals by project without inventing unavailable detail splits', () => {
    const projected = reconcileDurableProjectDay(fixtureDay(), { include: ['alpha'] })

    expect(projected.cost).toBe(60)
    expect(projected.calls).toBe(6)
    expect(projected.sessions).toBe(2)
    expect(projected.inputTokens).toBe(0)
    expect(projected.outputTokens).toBe(0)
    expect(projected.models).toEqual({})
    expect(projected.categories).toEqual({})
    expect(Object.keys(projected.projects ?? {})).toEqual(['alpha'])
    expect(projected.providers.claude?.cost).toBe(50)
    expect(projected.providers.codex?.cost).toBe(10)
    expect(projected.providers.claude?.inputTokens).toBe(0)
  })

  it('keeps non-excluded projects and unattributed history', () => {
    const projected = reconcileDurableProjectDay(fixtureDay(), { exclude: ['alpha'] })

    expect(projected.cost).toBe(40)
    expect(projected.calls).toBe(4)
    expect(projected.sessions).toBe(3)
    expect(projected.projects?.beta?.cost).toBe(30)
    expect(projected.projects?.[UNATTRIBUTED_PROJECT_KEY]?.cost).toBe(10)
    expect(projected.providers.claude?.cost).toBe(25)
    expect(projected.providers.codex?.cost).toBe(15)
  })

  it('exposes a legacy day with no project split only as unattributed', () => {
    const legacy = fixtureDay()
    delete legacy.projects
    for (const slice of Object.values(legacy.providers)) delete slice.projects

    const unattributed = reconcileDurableProjectDay(legacy, { include: ['unattributed'] })
    expect(unattributed.cost).toBe(100)
    expect(unattributed.calls).toBe(10)
    expect(unattributed.projects?.[UNATTRIBUTED_PROJECT_KEY]?.cost).toBe(100)

    const realProject = reconcileDurableProjectDay(legacy, { include: ['alpha'] })
    expect(realProject.cost).toBe(0)
    expect(realProject.calls).toBe(0)
    expect(realProject.projects).toBeUndefined()
  })

  it('preserves detailed fields only for a day already filtered from live records', () => {
    const projected = reconcileDurableProjectDay(
      fixtureDay(),
      { include: ['alpha'] },
      { preserveDetailedBreakdown: true },
    )

    expect(projected.cost).toBe(60)
    expect(projected.inputTokens).toBe(1_000)
    expect(projected.models).toEqual(fixtureDay().models)
    expect(projected.providers.claude?.inputTokens).toBe(800)
  })

  it('intersects provider and project scopes deterministically', () => {
    const providerDay = sliceDayToProvider(fixtureDay(), 'claude')
    const projected = reconcileDurableProjectDay(providerDay, { exclude: ['alpha'] })

    expect(projected.cost).toBe(25)
    expect(projected.calls).toBe(3)
    expect(Object.keys(projected.providers)).toEqual(['claude'])
    expect(projected.projects?.beta?.cost).toBe(20)
    expect(projected.projects?.[UNATTRIBUTED_PROJECT_KEY]?.cost).toBe(5)
  })

  it.each(['__proto__', 'constructor', 'toString'])('keeps %s as an own project key', projectName => {
    const day = fixtureDay()
    day.cost = 12
    day.calls = 2
    day.sessions = 1
    day.savingsUSD = 0
    day.projects = projectRecord([
      [projectName, { cost: 12, calls: 2, savingsUSD: 0, sessions: 1, path: `/repo/${projectName}` }],
    ])
    day.providers = providerRecord([])

    const projected = reconcileDurableProjectDay(day, { include: [projectName] })
    expect(Object.hasOwn(projected.projects ?? {}, projectName)).toBe(true)
    expect(projected.projects?.[projectName]?.cost).toBe(12)
    expect(Object.getPrototypeOf(projected.projects)).toBeNull()
  })
})
