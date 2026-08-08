import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const CACHE_MIGRATION_VERSION = 1

export function cacheMigrationMarkerPath(cacheDir: string, kind: string): string {
  return join(cacheDir, `${kind}-migration.v${CACHE_MIGRATION_VERSION}.json`)
}

export async function cacheMigrationCompleted(
  markerPath: string,
  canonicalPath: string,
  kind: string,
  isUsableCanonical?: (value: unknown) => boolean,
): Promise<boolean> {
  if (!existsSync(canonicalPath)) return false
  try {
    const canonical = JSON.parse(await readFile(canonicalPath, 'utf-8')) as unknown
    if (isUsableCanonical && !isUsableCanonical(canonical)) return false
    const raw = JSON.parse(await readFile(markerPath, 'utf-8')) as {
      version?: unknown
      kind?: unknown
    }
    return raw.version === CACHE_MIGRATION_VERSION && raw.kind === kind
  } catch {
    return false
  }
}

/** Persist only after the canonical cache has been atomically published. */
export async function writeCacheMigrationMarker(
  markerPath: string,
  kind: string,
  sources: readonly string[],
): Promise<void> {
  await mkdir(dirname(markerPath), { recursive: true })
  const tempPath = `${markerPath}.${randomBytes(8).toString('hex')}.tmp`
  const payload = JSON.stringify({
    version: CACHE_MIGRATION_VERSION,
    kind,
    migratedAt: new Date().toISOString(),
    sources: [...sources],
  })
  const handle = await open(tempPath, 'w', 0o600)
  try {
    await handle.writeFile(payload, { encoding: 'utf-8' })
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tempPath, markerPath)
  } catch (error) {
    try { await unlink(tempPath) } catch { /* best effort */ }
    throw error
  }
}
