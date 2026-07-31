export const QOVRION_STORAGE_PREFIX = 'qovrion.'
export const LEGACY_STORAGE_PREFIX = 'codeburn.'

export const KNOWN_STORAGE_SUFFIXES = [
  'defaultPeriod',
  'claudeConfigSource',
  'theme',
  'dailyBudget',
  'dailyBudget.dismissed',
  'refreshInterval',
] as const

export type KnownStorageSuffix = typeof KNOWN_STORAGE_SUFFIXES[number]

type StorageSurface = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function surface(): StorageSurface | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function storageKeys(suffix: string): { canonical: string; legacy: string } {
  return {
    canonical: `${QOVRION_STORAGE_PREFIX}${suffix}`,
    legacy: `${LEGACY_STORAGE_PREFIX}${suffix}`,
  }
}

/** Canonical wins. A legacy value is copied forward but never removed. */
export function readCompatStorage(suffix: string, storage = surface()): string | null {
  if (!storage) return null
  const keys = storageKeys(suffix)
  try {
    const canonical = storage.getItem(keys.canonical)
    if (canonical !== null) return canonical

    const legacy = storage.getItem(keys.legacy)
    if (legacy === null) return null
    try { storage.setItem(keys.canonical, legacy) } catch { /* best effort migration */ }
    return legacy
  } catch {
    return null
  }
}

/** Dual-write during the compatibility window so an old binary can roll back. */
export function writeCompatStorage(suffix: string, value: string, storage = surface()): void {
  if (!storage) return
  const keys = storageKeys(suffix)
  try { storage.setItem(keys.canonical, value) } catch { /* hardened storage */ }
  try { storage.setItem(keys.legacy, value) } catch { /* rollback compatibility */ }
}

/** Explicit removal mirrors the user's intent across both generations. */
export function removeCompatStorage(suffix: string, storage = surface()): void {
  if (!storage) return
  const keys = storageKeys(suffix)
  try { storage.removeItem(keys.canonical) } catch { /* hardened storage */ }
  try { storage.removeItem(keys.legacy) } catch { /* rollback compatibility */ }
}

export function migrateKnownStorage(storage = surface()): void {
  for (const suffix of KNOWN_STORAGE_SUFFIXES) readCompatStorage(suffix, storage)
}
