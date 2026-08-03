export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'other'

type NavigatorPlatform = Pick<Navigator, 'platform' | 'userAgent'>

export function detectDesktopPlatform(source?: Partial<NavigatorPlatform>): DesktopPlatform {
  const nav = source ?? (typeof navigator === 'undefined' ? {} : navigator)
  const fingerprint = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`.toLowerCase()
  if (fingerprint.includes('mac')) return 'macos'
  if (fingerprint.includes('win')) return 'windows'
  if (fingerprint.includes('linux') || fingerprint.includes('x11')) return 'linux'
  return 'other'
}

export function shortcutModifierLabel(platform = detectDesktopPlatform()): '⌘' | 'Ctrl+' {
  return platform === 'macos' ? '⌘' : 'Ctrl+'
}

export function shortcutLabel(key: string, platform = detectDesktopPlatform()): string {
  return `${shortcutModifierLabel(platform)}${key}`
}

export function shortcutRangeLabel(from: string, to: string, platform = detectDesktopPlatform()): string {
  return `${shortcutModifierLabel(platform)}${from}-${to}`
}

export function isPrimaryShortcut(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform = detectDesktopPlatform(),
): boolean {
  if (event.altKey || event.shiftKey) return false
  if (platform === 'macos') return event.metaKey && !event.ctrlKey
  return event.ctrlKey && !event.metaKey
}
