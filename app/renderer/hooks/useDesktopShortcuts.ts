import { useEffect } from 'react'

import { SECTION_BY_SHORTCUT, type Section } from '../lib/desktopNavigation'
import { detectDesktopPlatform, isPrimaryShortcut, type DesktopPlatform } from '../lib/shortcuts'

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
      const section = SECTION_BY_SHORTCUT[key]
      if (section) navigate(section)
      else if (key === 'r') refresh()
      else return
      event.preventDefault()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate, platform, refresh])
}
