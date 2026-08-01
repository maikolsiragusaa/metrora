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
  it('prefers Metrora over Qovrion and CodeBurn', () => {
    const keys = storageKeys('theme')
    const storage = memoryStorage({ [keys.canonical]: 'dark', [keys.qovrion]: 'light', [keys.codeburn]: 'system' })
    expect(readCompatStorage('theme', storage)).toBe('dark')
  })

  it('copies a Qovrion value forward without deleting it', () => {
    const keys = storageKeys('defaultPeriod')
    const storage = memoryStorage({ [keys.qovrion]: '30days', [keys.codeburn]: 'week' })
    expect(readCompatStorage('defaultPeriod', storage)).toBe('30days')
    expect(storage.getItem(keys.canonical)).toBe('30days')
    expect(storage.getItem(keys.qovrion)).toBe('30days')
  })

  it('falls through to CodeBurn when no newer value exists', () => {
    const keys = storageKeys('theme')
    const storage = memoryStorage({ [keys.codeburn]: 'light' })
    expect(readCompatStorage('theme', storage)).toBe('light')
    expect(storage.getItem(keys.canonical)).toBe('light')
  })

  it('writes every supported generation for rollback compatibility', () => {
    const keys = storageKeys('refreshInterval')
    const storage = memoryStorage()
    writeCompatStorage('refreshInterval', '5m', storage)
    expect(storage.getItem(keys.canonical)).toBe('5m')
    expect(storage.getItem(keys.qovrion)).toBe('5m')
    expect(storage.getItem(keys.codeburn)).toBe('5m')
  })

  it('removes every generation only for an explicit removal', () => {
    const keys = storageKeys('dailyBudget')
    const storage = memoryStorage({ [keys.canonical]: 'a', [keys.qovrion]: 'a', [keys.codeburn]: 'a' })
    removeCompatStorage('dailyBudget', storage)
    expect(storage.getItem(keys.canonical)).toBeNull()
    expect(storage.getItem(keys.qovrion)).toBeNull()
    expect(storage.getItem(keys.codeburn)).toBeNull()
  })

  it('migrates the known key set idempotently', () => {
    const theme = storageKeys('theme')
    const budget = storageKeys('dailyBudget')
    const storage = memoryStorage({ [theme.qovrion]: 'dark', [budget.codeburn]: '{"kind":"usd","value":10}' })
    migrateKnownStorage(storage)
    migrateKnownStorage(storage)
    expect(storage.getItem(theme.canonical)).toBe('dark')
    expect(storage.getItem(budget.canonical)).toBe('{"kind":"usd","value":10}')
  })
})
