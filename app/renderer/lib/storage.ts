export const METRORA_STORAGE_PREFIX = 'metrora.'
export const LEGACY_QOVRION_STORAGE_PREFIX = 'qovrion.'
export const LEGACY_CODEBURN_STORAGE_PREFIX = 'codeburn.'

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

export function storageKeys(suffix: string): { canonical: string; qovrion: string; codeburn: string } {
  return {
    canonical: `${METRORA_STORAGE_PREFIX}${suffix}`,
    qovrion: `${LEGACY_QOVRION_STORAGE_PREFIX}${suffix}`,
    codeburn: `${LEGACY_CODEBURN_STORAGE_PREFIX}${suffix}`,
  }
}

/** Metrora wins, then Qovrion, then CodeBurn. Old values are copied forward only. */
export function readCompatStorage(suffix: string, storage = surface()): string | null {
  if (!storage) return null
  const keys = storageKeys(suffix)
  try {
    const canonical = storage.getItem(keys.canonical)
    if (canonical !== null) return canonical

    for (const legacyKey of [keys.qovrion, keys.codeburn]) {
      const legacy = storage.getItem(legacyKey)
      if (legacy === null) continue
      try { storage.setItem(keys.canonical, legacy) } catch { /* best effort migration */ }
      return legacy
    }
    return null
  } catch {
    return null
  }
}

/** Write every supported generation so a rollback can still read current settings. */
export function writeCompatStorage(suffix: string, value: string, storage = surface()): void {
  if (!storage) return
  const keys = storageKeys(suffix)
  for (const key of [keys.canonical, keys.qovrion, keys.codeburn]) {
    try { storage.setItem(key, value) } catch { /* hardened storage */ }
  }
}

/** Explicit removal mirrors the user's intent across every supported generation. */
export function removeCompatStorage(suffix: string, storage = surface()): void {
  if (!storage) return
  const keys = storageKeys(suffix)
  for (const key of [keys.canonical, keys.qovrion, keys.codeburn]) {
    try { storage.removeItem(key) } catch { /* hardened storage */ }
  }
}

export function migrateKnownStorage(storage = surface()): void {
  for (const suffix of KNOWN_STORAGE_SUFFIXES) readCompatStorage(suffix, storage)
}
