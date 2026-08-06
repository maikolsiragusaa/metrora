import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type MetroraPathEnvironment = NodeJS.ProcessEnv

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
    'QOVRION_CONFIG_DIR',
    'CODEBURN_CONFIG_DIR',
  ])
  if (explicit) return explicit

  const base = standardBase(env, 'XDG_CONFIG_HOME', home, '.config')
  return existingOrCanonical(
    join(base, 'metrora'),
    [join(base, 'qovrion'), join(base, 'codeburn')],
  )
}

/**
 * New installations use the Metrora cache root. Explicit Metrora overrides
 * win, followed by temporary compatibility aliases; an existing legacy default
 * is adopted in place rather than abandoned, preserving durable history.
 */
export function getMetroraCacheDir(
  env: MetroraPathEnvironment = process.env,
  home: string = homedir(),
): string {
  const explicit = firstExplicit(env, [
    'METRORA_CACHE_DIR',
    'QOVRION_CACHE_DIR',
    'CODEBURN_CACHE_DIR',
  ])
  if (explicit) return explicit

  const base = standardBase(env, 'XDG_CACHE_HOME', home, '.cache')
  return existingOrCanonical(
    join(base, 'metrora'),
    [join(base, 'qovrion'), join(base, 'codeburn')],
  )
}
