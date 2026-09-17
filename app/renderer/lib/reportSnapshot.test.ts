// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  MAX_STORED_SNAPSHOTS,
  invalidateDurableSnapshots,
  isCompleteReport,
  isPersistableReport,
  readDurableSnapshot,
  snapshotRank,
  writeDurableSnapshot,
} from './reportSnapshot'
import { storageKey } from './storage'

function payload(reconciliation: string, cost = 1) {
  return { current: { cost }, freshness: { readMode: 'fresh', reconciliation, durableThrough: '2026-09-16' } }
}

function storedKeys(): string[] {
  const out: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith(storageKey('reportSnapshot.v1.'))) out.push(key)
  }
  return out
}

beforeEach(() => {
  localStorage.clear()
  invalidateDurableSnapshots()
  localStorage.clear()
})

describe('report snapshot freshness ranks', () => {
  it('ranks complete above targeted above degraded', () => {
    expect(snapshotRank(payload('complete'))).toBe(2)
    expect(snapshotRank(payload('targeted'))).toBe(1)
    expect(snapshotRank(payload('degraded'))).toBe(0)
    expect(snapshotRank('plain-string')).toBe(1)
    expect(snapshotRank(null)).toBe(1)
  })

  it('treats only complete as a finished answer', () => {
    expect(isCompleteReport(payload('complete'))).toBe(true)
    expect(isCompleteReport(payload('targeted'))).toBe(false)
    expect(isCompleteReport(payload('degraded'))).toBe(false)
  })

  it('persists only freshness-enveloped values', () => {
    expect(isPersistableReport(payload('complete'))).toBe(true)
    expect(isPersistableReport([{ sessionId: 's1' }])).toBe(false)
    expect(isPersistableReport('scalar')).toBe(false)
  })
})

describe('durable snapshot store', () => {
  it('round-trips a complete report and refuses degraded and targeted writes', () => {
    writeDurableSnapshot('scope|all', payload('complete', 7), 1000)
    expect(readDurableSnapshot<{ current: { cost: number } }>('scope|all')).toMatchObject({ value: { current: { cost: 7 } }, at: 1000 })

    writeDurableSnapshot('scope|degraded', payload('degraded', 3), 1001)
    expect(readDurableSnapshot('scope|degraded')).toBeUndefined()

    // Targeted reads are honest for their slice in memory but must never
    // become the restart-time exact answer.
    writeDurableSnapshot('scope|targeted', payload('targeted', 4), 1002)
    expect(readDurableSnapshot('scope|targeted')).toBeUndefined()
    expect(storedKeys()).toHaveLength(1)
  })

  it('replaces a complete snapshot with a newer complete one, never with a degraded one', () => {
    writeDurableSnapshot('scope|all', payload('complete', 7), 1000)
    writeDurableSnapshot('scope|all', payload('complete', 9), 2000)
    expect(readDurableSnapshot<{ current: { cost: number } }>('scope|all')?.value.current.cost).toBe(9)
  })

  it('keeps byte-identical polls from rewriting the body', () => {
    writeDurableSnapshot('scope|all', payload('complete', 7), 1000)
    const before = localStorage.getItem(storageKey('reportSnapshot.v1.scope|all'))
    writeDurableSnapshot('scope|all', payload('complete', 7), 2000)
    expect(localStorage.getItem(storageKey('reportSnapshot.v1.scope|all'))).toBe(before)
  })

  it('refuses oversized payloads, staying memory-only', () => {
    const big = { current: { cost: 1, pad: 'x'.repeat(2_000_000) }, freshness: { readMode: 'fresh', reconciliation: 'complete', durableThrough: null } }
    writeDurableSnapshot('scope|big', big, 1000)
    expect(readDurableSnapshot('scope|big')).toBeUndefined()
    expect(storedKeys()).toHaveLength(0)
  })

  it('bounds the stored snapshot count, oldest first', () => {
    for (let i = 0; i < MAX_STORED_SNAPSHOTS + 4; i++) {
      writeDurableSnapshot(`scope|${i}`, payload('complete', i), 1000 + i)
    }
    const keys = storedKeys()
    expect(keys.length).toBeLessThanOrEqual(MAX_STORED_SNAPSHOTS)
    // The newest scopes survive; the oldest were evicted.
    expect(readDurableSnapshot(`scope|${MAX_STORED_SNAPSHOTS + 3}`)).toBeDefined()
    expect(readDurableSnapshot('scope|0')).toBeUndefined()
  })

  it('makes snapshots unreadable across a generation bump even if bodies remain', () => {
    writeDurableSnapshot('scope|all', payload('complete', 7), 1000)
    expect(readDurableSnapshot('scope|all')).toBeDefined()
    invalidateDurableSnapshots()
    expect(readDurableSnapshot('scope|all')).toBeUndefined()
    expect(storedKeys()).toHaveLength(0)
  })

  it('ignores foreign keys and corrupt bodies', () => {
    localStorage.setItem('codeburn.reportSnapshot.v1.scope|all', '{"v":1,"at":1,"generation":0,"fingerprint":"x","value":{}}')
    localStorage.setItem(storageKey('reportSnapshot.v1.scope|broken'), 'not-json{')
    expect(readDurableSnapshot('scope|all')).toBeUndefined()
    expect(readDurableSnapshot('scope|broken')).toBeUndefined()
  })
})
