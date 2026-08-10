import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type MetroraPathEnvironment = NodeJS.ProcessEnv

export const LEGACY_CONFIG_DIR_ENV = 'CODEBURN_CONFIG_DIR'
export const LEGACY_CACHE_DIR_ENV = 'CODEBURN_CACHE_DIR'
export const LEGACY_PRODUCT_ROOT = 'codeburn'

function firstExplicit(env: MetroraPathEnvironment, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function existingOrCanonical(canonical: string, legacy: string[]): string {
  if (existsSync(canonical)) return canonical
  for (const candidate of legacy) {
    if (existsSync(candidate)) return candidate
  }
  return canonical
}

function standardBase(env: MetroraPathEnvironment, xdgName: string, home: string, fallback: string): string {
  const xdg = env[xdgName]?.trim()
  return xdg || join(home, fallback)
}

/**
 * New installations use the Metrora config root. Existing development-name or
 * inherited roots remain readable in place until a separately reviewed data
 * migration can copy/merge them without risking user state.
 */
export function getMetroraConfigDir(
  env: MetroraPathEnvironment = process.env,
  home: string = homedir(),
): string {
  const explicit = firstExplicit(env, [
    'METRORA_CONFIG_DIR',
    LEGACY_CONFIG_DIR_ENV,
  ])
  if (explicit) return explicit

  const base = standardBase(env, 'XDG_CONFIG_HOME', home, '.config')
  return existingOrCanonical(
    join(base, 'metrora'),
    [join(base, LEGACY_PRODUCT_ROOT)],
  )
}

/**
 * New installations and migrated installations always use the Metrora cache
 * root. Compatibility aliases are handled by the explicit read-only migration
 * path below and are never selected as the runtime cache directory.
 */
export function getMetroraCacheDir(
  env: MetroraPathEnvironment = process.env,
  home: string = homedir(),
): string {
  const explicit = firstExplicit(env, ['METRORA_CACHE_DIR'])
  if (explicit) return explicit

  const base = standardBase(env, 'XDG_CACHE_HOME', home, '.cache')
  return join(base, 'metrora')
}

/**
 * Cache roots that may contain pre-Metrora usage history. These paths are
 * migration inputs only: runtime reads and writes always use getMetroraCacheDir.
 * The explicit compatibility override is included even when the default legacy
 * root does not exist, so an administrator can relocate the old root safely.
 */
export function getMetroraLegacyCacheDirs(
  env: MetroraPathEnvironment = process.env,
  home: string = homedir(),
): string[] {
  const canonical = getMetroraCacheDir(env, home)
  const base = standardBase(env, 'XDG_CACHE_HOME', home, '.cache')
  const explicit = firstExplicit(env, [LEGACY_CACHE_DIR_ENV])
  const candidates = [explicit, join(base, LEGACY_PRODUCT_ROOT)].filter(
    (value): value is string => Boolean(value),
  )
  const canonicalKey = process.platform === 'win32' ? canonical.toLowerCase() : canonical
  const seen = new Set<string>()
  return candidates.filter(candidate => {
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate
    if (key === canonicalKey || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
