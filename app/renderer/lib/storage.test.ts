import { describe, expect, it } from 'vitest'

import {
  migrateKnownStorage,
  readCompatStorage,
  removeCompatStorage,
  storageKeys,
  writeCompatStorage,
} from './storage'

type MemoryStorage = Storage & { values: Map<string, string> }

function memoryStorage(seed: Record<string, string> = {}): MemoryStorage {
  const values = new Map(Object.entries(seed))
  return {
    values,
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

describe('renderer storage compatibility', () => {
  it('prefers Metrora over the legacy compatibility key', () => {
    const keys = storageKeys('theme')
    const storage = memoryStorage({ [keys.canonical]: 'dark', [keys.legacy]: 'system' })
    expect(readCompatStorage('theme', storage)).toBe('dark')
  })

  it('copies a legacy value forward without deleting it', () => {
    const keys = storageKeys('defaultPeriod')
    const storage = memoryStorage({ [keys.legacy]: '30days' })
    expect(readCompatStorage('defaultPeriod', storage)).toBe('30days')
    expect(storage.getItem(keys.canonical)).toBe('30days')
    expect(storage.getItem(keys.legacy)).toBe('30days')
  })

  it('returns null when no canonical or legacy value exists', () => {
    const keys = storageKeys('theme')
    const storage = memoryStorage()
    expect(readCompatStorage('theme', storage)).toBeNull()
    expect(storage.getItem(keys.canonical)).toBeNull()
  })

  it('writes only the canonical Metrora generation', () => {
    const keys = storageKeys('refreshInterval')
    const storage = memoryStorage()
    writeCompatStorage('refreshInterval', '5m', storage)
    expect(storage.getItem(keys.canonical)).toBe('5m')
    expect(storage.getItem(keys.legacy)).toBeNull()
  })

  it('removes canonical and legacy keys only for an explicit removal', () => {
    const keys = storageKeys('dailyBudget')
    const storage = memoryStorage({ [keys.canonical]: 'a', [keys.legacy]: 'a' })
    removeCompatStorage('dailyBudget', storage)
    expect(storage.getItem(keys.canonical)).toBeNull()
    expect(storage.getItem(keys.legacy)).toBeNull()
  })

  it('migrates the known key set idempotently', () => {
    const theme = storageKeys('theme')
    const budget = storageKeys('dailyBudget')
    const storage = memoryStorage({ [theme.legacy]: 'dark', [budget.legacy]: '{"kind":"usd","value":10}' })
    migrateKnownStorage(storage)
    migrateKnownStorage(storage)
    expect(storage.getItem(theme.canonical)).toBe('dark')
    expect(storage.getItem(budget.canonical)).toBe('{"kind":"usd","value":10}')
  })
})
