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

/**
 * New installations use ~/.config/metrora. Existing development-name or
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

  return existingOrCanonical(
    join(home, '.config', 'metrora'),
    [join(home, '.config', 'qovrion'), join(home, '.config', 'codeburn')],
  )
}

/**
 * New installations use ~/.cache/metrora. Explicit Metrora overrides win,
 * followed by temporary compatibility aliases; an existing legacy default is
 * adopted in place rather than abandoned, preserving durable history.
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

  return existingOrCanonical(
    join(home, '.cache', 'metrora'),
    [join(home, '.cache', 'qovrion'), join(home, '.cache', 'codeburn')],
  )
}
