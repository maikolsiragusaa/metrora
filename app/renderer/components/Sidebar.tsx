import type { ComponentProps } from 'react'

import { MetroraSidebar } from '../shell/sidebar/MetroraSidebar'

export type { Section } from '../lib/desktopNavigation'

/** Compatibility export for existing section consumers during shell migration. */
export function Sidebar(props: ComponentProps<typeof MetroraSidebar>) {
  return <MetroraSidebar {...props} />
}
