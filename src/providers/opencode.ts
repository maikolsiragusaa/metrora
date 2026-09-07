import { isAbsolute, join, normalize } from 'path'
import { homedir } from 'os'

import { getShortModelName } from '../models.js'
import { createSharedSqliteSessionParser, type SqliteProviderConfig } from './sqlite-session-parser.js'
import { discoverSqliteSessions } from './sqlite-session-discovery.js'
import { discoverOpenCodeFileSessions, createOpenCodeFileSessionParser } from './opencode-file-parser.js'
import type { Provider, ProbeRoot, SessionSource, SessionParser } from './types.js'

const toolNameMap: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  edit: 'Edit',
  write: 'Write',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Agent',
  fetch: 'WebFetch',
  search: 'WebSearch',
  todo: 'TodoWrite',
  skill: 'Skill',
  patch: 'Patch',
}

/** JSON-encoded additive roots used by Desktop to expose its owned DB to the collector. */
export const OPENCODE_ACCOUNTING_EXTRA_DATA_DIRS_ENV = 'METRORA_OPENCODE_EXTRA_DATA_DIRS'
const MAX_EXTRA_DATA_DIRS = 8
const MAX_EXTRA_DATA_DIRS_BYTES = 8 * 1024
const MAX_EXTRA_DATA_DIR_LENGTH = 4096

function getDataDir(dataDir?: string): string {
  // Test seam: createOpenCodeProvider(tmpDir) points at a base dir that still
  // gets the 'opencode' subdirectory appended, preserving existing fixtures
  // (tmpDir/opencode/opencode*.db and tmpDir/opencode/storage/...).
  if (dataDir) return join(dataDir, 'opencode')

  // Production override for OpenCode-compatible forks/renames (e.g. MiMoCode at
  // ~/.local/share/mimocode). This is the EXACT data directory — no 'opencode'
  // suffix — so a fork writing <dir>/<prefix>*.db or <dir>/storage/... is found
  // instead of silently yielding zero sessions. (issue #617)
  const override = process.env['OPENCODE_DATA_DIR']
  if (override) return override

  // Default: $XDG_DATA_HOME/opencode or ~/.local/share/opencode.
  const base = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share')
  return join(base, 'opencode')
}

function getExtraDataDirs(): string[] {
  const raw = process.env[OPENCODE_ACCOUNTING_EXTRA_DATA_DIRS_ENV]
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_EXTRA_DATA_DIRS_BYTES) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_EXTRA_DATA_DIRS) return []

  const unique = new Map<string, string>()
  for (const value of parsed) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > MAX_EXTRA_DATA_DIR_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(value) ||
      !isAbsolute(value)
    ) continue

    const directory = normalize(value)
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory
    if (!unique.has(key)) unique.set(key, directory)
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(right))
}

function getDataDirs(dataDir?: string): string[] {
  const primary = getDataDir(dataDir)
  const roots = [primary, ...getExtraDataDirs()]
  const unique = new Map<string, string>()
  for (const root of roots) {
    const normalized = normalize(root)
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
    if (!unique.has(key)) unique.set(key, normalized)
  }
  return [...unique.values()]
}

function getDbFilePrefix(): string {
  // Keep the empty-string behavior aligned with the historical exact override.
  return process.env['OPENCODE_DB_PREFIX'] || 'opencode'
}

function getSqliteConfig(dbDir: string): SqliteProviderConfig {
  return {
    providerName: 'opencode',
    displayName: 'OpenCode',
    dbDir,
    // Truthy check (not `??`): an empty-string `OPENCODE_DB_PREFIX` must fall
    // back to 'opencode'. With `??`, '' survives as the prefix and
    // `discoverSqliteSessions` matches every '*.db' file (filename.startsWith('')
    // is always true), sweeping unrelated DBs into discovery. Aligns with
    // `OPENCODE_DATA_DIR`'s truthy handling above, and makes behavior identical
    // for unset vs empty — which matches the env fingerprint, since
    // `computeEnvFingerprint` collapses both to 'OPENCODE_DB_PREFIX='. (issue #617)
    dbFilePrefix: getDbFilePrefix(),
  }
}

function dataDirFromFileSource(sourcePath: string, fallback: string): string {
  const normalized = sourcePath.replaceAll('\\', '/')
  const marker = '/storage/session/'
  const markerIndex = normalized.indexOf(marker)
  return markerIndex >= 0 ? normalized.slice(0, markerIndex) : fallback
}

export function createOpenCodeProvider(dataDir?: string): Provider {
  // The shared parser's dbDir/prefix are only diagnostic metadata; discovery
  // resolves the current roots and prefix on every call so the singleton also
  // responds to Desktop/test environment changes in a long-lived process.
  const createSqliteParser = createSharedSqliteSessionParser(getSqliteConfig(''))

  return {
    name: 'opencode',
    displayName: 'OpenCode',
    cacheSourceRecordsIndependently: true,

    modelDisplayName(model: string): string {
      const stripped = model.replace(/^[^/]+\//, '')
      return getShortModelName(stripped)
    },

    toolDisplayName(rawTool: string): string {
      return toolNameMap[rawTool] ?? rawTool
    },

    // OpenCode migrated from file-based JSON (storage/session/*.json) to a
    // SQLite DB (opencode.db). After an in-place upgrade, legacy JSON files
    // remain on disk while all new data flows into the SQLite DB. Merge both
    // sources so migrated installs keep reporting legacy sessions AND pick up
    // current SQLite data. Dedup is handled per-message in createSessionParser
    // via seenKeys (keyed by `${provider}:${sessionId}:${messageId}`).
    // Both the legacy JSON store (storage/session/*.json) and the SQLite DB
    // (opencode*.db) live under every resolved data dir. Desktop adds its
    // Metrora-owned DB directory through the bounded JSON env contract above;
    // the standalone root remains the primary source.
    async probeRoots(): Promise<ProbeRoot[]> {
      return getDataDirs(dataDir).map((path, index) => ({
        path,
        label: index === 0 ? 'data' : `extra-data-${index}`,
      }))
    },

    async discoverSessions(): Promise<SessionSource[]> {
      const fileSessions: SessionSource[] = []
      const sqliteSessions: SessionSource[] = []
      for (const root of getDataDirs(dataDir)) {
        fileSessions.push(...await discoverOpenCodeFileSessions(root, 'opencode'))
        sqliteSessions.push(...await discoverSqliteSessions(getSqliteConfig(root)))
      }
      return [...fileSessions, ...sqliteSessions]
    },

    createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
      if (source.path.endsWith('.json')) {
        return createOpenCodeFileSessionParser(source, seenKeys, dataDirFromFileSource(source.path, getDataDir(dataDir)), 'opencode')
      }
      return createSqliteParser(source, seenKeys)
    },
  }
}

export const opencode = createOpenCodeProvider()
