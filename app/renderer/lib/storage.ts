export const METRORA_STORAGE_PREFIX = 'metrora.'

type StorageSurface = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function surface(): StorageSurface | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function storageKey(suffix: string): string {
  return `${METRORA_STORAGE_PREFIX}${suffix}`
}

export function readStorage(suffix: string, storage = surface()): string | null {
  if (!storage) return null
  try { return storage.getItem(storageKey(suffix)) } catch { return null }
}

export function writeStorage(suffix: string, value: string, storage = surface()): void {
  if (!storage) return
  try { storage.setItem(storageKey(suffix), value) } catch { /* hardened storage */ }
}

export function removeStorage(suffix: string, storage = surface()): void {
  if (!storage) return
  try { storage.removeItem(storageKey(suffix)) } catch { /* hardened storage */ }
}
