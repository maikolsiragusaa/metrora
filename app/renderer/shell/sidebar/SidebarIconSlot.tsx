/*
 * Adapted from OpenHands/OpenHands
 * Original path: src/components/features/sidebar/sidebar-collapsed-icon-slot.tsx
 * Exact source: 1a34e0222ee9e3c1f8c13fc16d28e69361a022ff
 * Licence: MIT; see LICENSES/OPENHANDS-MIT.txt
 * Metrora modification: retained the layered collapsed hit target while using
 * Metrora-owned class names and without the upstream utility dependency.
 */

import type { ReactNode } from 'react'

import {
  SIDEBAR_COLLAPSED_ICON_SLOT_CLASS,
  sidebarCollapsedIconBgClassName,
  sidebarCollapsedIconGlyphClassName,
} from '../../ui/primitives/sidebar-layout'

export function SidebarIconSlot({
  active,
  className,
  children,
}: {
  active: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span className={[SIDEBAR_COLLAPSED_ICON_SLOT_CLASS, className].filter(Boolean).join(' ')}>
      <span aria-hidden="true" className={sidebarCollapsedIconBgClassName(active)} />
      <span className={sidebarCollapsedIconGlyphClassName(active)}>{children}</span>
    </span>
  )
}
