import { homedir } from 'node:os'
import { join } from 'node:path'

export type MetroraPathEnvironment = NodeJS.ProcessEnv

function explicitPath(env: MetroraPathEnvironment, name: string): string | undefined {
  const value = env[name]?.trim()
  return value || undefined
}

function standardBase(env: MetroraPathEnvironment, xdgName: string, home: string, fallback: string): string {
  return env[xdgName]?.trim() || join(home, fallback)
}

/** Resolve the canonical Metrora configuration root. */
export function getMetroraConfigDir(
  env: MetroraPathEnvironment = process.env,
  home: string = homedir(),
): string {
  return explicitPath(env, 'METRORA_CONFIG_DIR')
    ?? join(standardBase(env, 'XDG_CONFIG_HOME', home, '.config'), 'metrora')
}

/** Resolve the canonical Metrora cache root. */
export function getMetroraCacheDir(
  env: MetroraPathEnvironment = process.env,
  home: string = homedir(),
): string {
  return explicitPath(env, 'METRORA_CACHE_DIR')
    ?? join(standardBase(env, 'XDG_CACHE_HOME', home, '.cache'), 'metrora')
}
