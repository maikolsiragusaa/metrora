import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'

import * as session from './session-cache.js'
import { cacheMigrationCompleted, cacheMigrationMarkerPath, writeCacheMigrationMarker } from './cache-migration.js'
import { getMetroraCacheDir, getMetroraLegacyCacheDirs } from './product-paths.js'

type LegacyDurableCandidate = {
  version: number
  mtimeMs: number
  providers: Record<string, session.ProviderSection>
  path: string
}

async function readLegacyDurableProviders(): Promise<{ providers: Record<string, session.ProviderSection>; paths: string[] } | null> {
  const candidates: LegacyDurableCandidate[] = []
  const seenDirs = new Set<string>()
  const seenFiles = new Set<string>()
  for (const dir of getMetroraLegacyCacheDirs()) {
    const dirKey = process.platform === 'win32' ? dir.toLowerCase() : dir
    if (seenDirs.has(dirKey)) continue
    seenDirs.add(dirKey)
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.startsWith('session-cache') || !name.includes('.json')) continue
      const path = join(dir, name)
      const fileKey = process.platform === 'win32' ? path.toLowerCase() : path
      if (seenFiles.has(fileKey)) continue
      seenFiles.add(fileKey)
      try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
        if (!parsed || typeof parsed !== 'object') continue
        const envelope = parsed as { version?: unknown; providers?: unknown }
        if (typeof envelope.version !== 'number' || !envelope.providers || typeof envelope.providers !== 'object' || Array.isArray(envelope.providers)) continue

        const providers: Record<string, session.ProviderSection> = {}
        for (const provider of session.DURABLE_PROVIDER_NAMES) {
          const section = (envelope.providers as Record<string, unknown>)[provider]
          if (!section || typeof section !== 'object' || Array.isArray(section)) continue
          const rawFiles = (section as Record<string, unknown>).files
          if (!rawFiles || typeof rawFiles !== 'object' || Array.isArray(rawFiles)) continue
          const files: Record<string, session.CachedFile> = {}
          for (const [sourcePath, file] of Object.entries(rawFiles as Record<string, unknown>)) {
            if (session.validateCachedFile(file)) files[sourcePath] = structuredClone(file)
          }
          if (Object.keys(files).length === 0) continue
          providers[provider] = {
            envFingerprint: session.computeEnvFingerprint(provider),
            files,
            durable: true,
          }
        }
        if (Object.keys(providers).length === 0) continue
        candidates.push({ version: envelope.version, mtimeMs: (await stat(path)).mtimeMs, providers, path })
      } catch {
        // One malformed provider cache cannot suppress valid durable files in
        // another source. The old file is intentionally left untouched.
      }
    }
  }
  if (candidates.length === 0) return null
  // Older files first; later versions overwrite the same source path while
  // retaining durable files that exist only in an older snapshot.
  candidates.sort((a, b) => (a.version - b.version) || (a.mtimeMs - b.mtimeMs))
  const providers: Record<string, session.ProviderSection> = {}
  for (const candidate of candidates) {
    for (const [provider, section] of Object.entries(candidate.providers)) {
      const existing = providers[provider]
      if (!existing) {
        providers[provider] = structuredClone(section)
        continue
      }
      Object.assign(existing.files, section.files)
      existing.durable = true
    }
  }
  return { providers, paths: candidates.map(candidate => candidate.path) }
}

function mergeLegacyDurableProviders(base: session.SessionCache, providers: Record<string, session.ProviderSection>): session.SessionCache {
  const merged = structuredClone(base)
  for (const [provider, legacySection] of Object.entries(providers)) {
    const current = merged.providers[provider]
    if (!current) {
      merged.providers[provider] = structuredClone(legacySection)
      continue
    }
    current.durable = true
    // The canonical session entry is authoritative for a source path. Legacy
    // contributes only files that the new root does not have, so a repeated
    // migration cannot double-count Copilot usage.
    for (const [sourcePath, file] of Object.entries(legacySection.files)) {
      if (!Object.hasOwn(current.files, sourcePath)) current.files[sourcePath] = structuredClone(file)
    }
  }
  return merged
}

export async function migrateLegacyDurableSessionCache(base: session.SessionCache): Promise<session.SessionCache> {
  const markerPath = cacheMigrationMarkerPath(getMetroraCacheDir(), 'session-cache')
  if (await cacheMigrationCompleted(markerPath, session.sessionCachePath(), 'session-cache', session.isValidCache)) return base
  const legacy = await readLegacyDurableProviders()
  if (!legacy) return base
  const merged = mergeLegacyDurableProviders(base, legacy.providers)
  try {
    await session.saveCache(merged)
    await writeCacheMigrationMarker(markerPath, 'session-cache', legacy.paths)
  } catch {
    // The canonical write is atomic; retain the in-memory merge for this run
    // and retry from the untouched source on a later launch if publication failed.
  }
  return merged
}
