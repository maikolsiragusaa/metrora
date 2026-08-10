import { describe, expect, it } from 'vitest'

import {
  METRORA_STORAGE_PREFIX,
  readStorage,
  removeStorage,
  storageKey,
  writeStorage,
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

describe('renderer storage', () => {
  it('uses the canonical Metrora namespace', () => {
    expect(METRORA_STORAGE_PREFIX).toBe('metrora.')
    expect(storageKey('theme')).toBe('metrora.theme')
  })

  it('reads a canonical value without creating other keys', () => {
    const storage = memoryStorage({ [storageKey('defaultPeriod')]: '30days' })
    expect(readStorage('defaultPeriod', storage)).toBe('30days')
    expect([...storage.values.keys()]).toEqual(['metrora.defaultPeriod'])
  })

  it('returns null when no canonical value exists', () => {
    const storage = memoryStorage()
    expect(readStorage('theme', storage)).toBeNull()
  })

  it('writes only the canonical Metrora generation', () => {
    const storage = memoryStorage()
    writeStorage('refreshInterval', '5m', storage)
    expect(storage.getItem(storageKey('refreshInterval'))).toBe('5m')
    expect([...storage.values.keys()]).toEqual(['metrora.refreshInterval'])
  })

  it('removes only the canonical key', () => {
    const storage = memoryStorage({ [storageKey('dailyBudget')]: 'a', 'previous-product.dailyBudget': 'a' })
    removeStorage('dailyBudget', storage)
    expect(storage.getItem(storageKey('dailyBudget'))).toBeNull()
    expect(storage.getItem('previous-product.dailyBudget')).toBe('a')
  })
})
