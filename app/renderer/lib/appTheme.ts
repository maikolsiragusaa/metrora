import { readStorage, writeStorage } from './storage'

/**
 * Canonical Metrora product theme.
 *
 * Metrora is the desktop-level appearance authority and supports only Dark
 * and Light. There is no System mode: the OS appearance is never consulted.
 * Electron's `nativeTheme.themeSource` mirrors this selection so embedded
 * surfaces that follow `prefers-color-scheme` (e.g. OpenCode's official
 * System color scheme) track Metrora automatically. Upstream preferences
 * themselves are never written by Metrora.
 */
export type MetroraTheme = 'dark' | 'light'

export const DEFAULT_METRORA_THEME: MetroraTheme = 'dark'

const THEME_STORAGE_SUFFIX = 'theme'

/**
 * Single canonical rule for interpreting the stored preference.
 * Legacy `system`, missing, and invalid values all resolve to Dark.
 */
export function resolveMetroraTheme(value: unknown): MetroraTheme {
  return value === 'dark' || value === 'light' ? value : DEFAULT_METRORA_THEME
}

export function readMetroraTheme(): MetroraTheme {
  return resolveMetroraTheme(readStorage(THEME_STORAGE_SUFFIX))
}

function applyRootTheme(theme: MetroraTheme): void {
  document.documentElement.setAttribute('data-theme', theme)
}

/**
 * Renderer startup: resolve (migrating legacy `system`/invalid to Dark),
 * persist the explicit result, and apply it to the root. Always returns a
 * concrete theme; `data-theme` is never removed.
 */
export function initializeMetroraTheme(): MetroraTheme {
  const theme = readMetroraTheme()
  writeStorage(THEME_STORAGE_SUFFIX, theme)
  applyRootTheme(theme)
  return theme
}

/** Persist a user-selected theme and apply it to the root. */
export function persistMetroraTheme(theme: MetroraTheme): void {
  writeStorage(THEME_STORAGE_SUFFIX, theme)
  applyRootTheme(theme)
}
