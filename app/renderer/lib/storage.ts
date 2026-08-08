export const METRORA_STORAGE_PREFIX = 'metrora.'
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
    canonical: `${METRORA_STORAGE_PREFIX}${suffix}`,
    legacy: `${LEGACY_STORAGE_PREFIX}${suffix}`,
  }
}

/** Read canonical Metrora settings, adopting a legacy key once. */
export function readCompatStorage(suffix: string, storage = surface()): string | null {
  if (!storage) return null
  const keys = storageKeys(suffix)
  try {
    const canonical = storage.getItem(keys.canonical)
    if (canonical !== null) return canonical

    const legacy = storage.getItem(keys.legacy)
    if (legacy !== null) {
      try { storage.setItem(keys.canonical, legacy) } catch { /* best effort migration */ }
      return legacy
    }
    return null
  } catch {
    return null
  }
}

/** New writes use only the canonical Metrora namespace. */
export function writeCompatStorage(suffix: string, value: string, storage = surface()): void {
  if (!storage) return
  const keys = storageKeys(suffix)
  try { storage.setItem(keys.canonical, value) } catch { /* hardened storage */ }
}

/** Explicit removal mirrors the user's intent across every supported generation. */
export function removeCompatStorage(suffix: string, storage = surface()): void {
  if (!storage) return
  const keys = storageKeys(suffix)
  for (const key of [keys.canonical, keys.legacy]) {
    try { storage.removeItem(key) } catch { /* hardened storage */ }
  }
}

export function migrateKnownStorage(storage = surface()): void {
  for (const suffix of KNOWN_STORAGE_SUFFIXES) readCompatStorage(suffix, storage)
}
