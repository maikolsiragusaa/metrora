import { useEffect } from 'react'

import type { Section } from '../components/Sidebar'
import { detectDesktopPlatform, isPrimaryShortcut, type DesktopPlatform } from '../lib/shortcuts'

const SECTION_SHORTCUTS: Record<string, Section> = {
  '1': 'overview',
  '2': 'sessions',
  '3': 'pullRequests',
  '4': 'spend',
  '5': 'optimize',
  '6': 'models',
  '7': 'compare',
  '8': 'plans',
  '9': 'workspace',
  ',': 'settings',
}

export function useDesktopShortcuts({
  navigate,
  refresh,
  platform = detectDesktopPlatform(),
}: {
  navigate: (section: Section) => void
  refresh: () => void
  platform?: DesktopPlatform
}): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPrimaryShortcut(event, platform)) return
      const key = event.key.toLowerCase()
      const section = SECTION_SHORTCUTS[key]
      if (section) navigate(section)
      else if (key === 'r') refresh()
      else return
      event.preventDefault()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate, platform, refresh])
}
