/*
 * Adapted from OpenHands/OpenHands
 * Original path: src/components/features/sidebar/sidebar-layout.ts
 * Exact source: 1a34e0222ee9e3c1f8c13fc16d28e69361a022ff
 * Licence: MIT; see LICENSES/OPENHANDS-MIT.txt
 * Metrora modification: translated the layout helpers to Metrora-owned CSS
 * classes and semantic tokens, removed Tailwind/cn coupling, and retained only
 * the compact expanded/collapsed row mechanics used by the Metrora shell.
 */

function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/** Nav rows intentionally snap their hover/active surface changes. */
export const navInteractiveTransitionClassName = 'metrora-sidebar__nav-transition'

/** Expanded sidebar icon column. */
export const SIDEBAR_ICON_SLOT_CLASS = 'metrora-sidebar__icon-slot'

/** Collapsed rail hit target. */
export const SIDEBAR_COLLAPSED_ICON_SLOT_CLASS = 'metrora-sidebar__collapsed-icon-slot'

export const SIDEBAR_HEADER_ROW_CLASS = 'metrora-sidebar__header-row'

export function sidebarHeaderRowClassName(collapsed: boolean): string {
  return joinClasses(
    SIDEBAR_HEADER_ROW_CLASS,
    collapsed && 'is-collapsed',
  )
}

export const SIDEBAR_ROW_INTERACTIVE_CLASS = {
  active: 'is-active',
  idle: 'is-idle',
} as const

export function sidebarNavListClassName(collapsed: boolean): string {
  return joinClasses(
    'metrora-sidebar__nav-list',
    collapsed && 'is-collapsed',
  )
}

export function sidebarNavRowClassName(options?: { indent?: boolean; collapsed?: boolean }): string {
  const { indent = false, collapsed = false } = options ?? {}
  return joinClasses(
    'metrora-sidebar__nav-item ni',
    navInteractiveTransitionClassName,
    collapsed && 'is-collapsed',
    indent && !collapsed && 'is-indented',
  )
}

export function sidebarCollapsedIconBgClassName(active: boolean): string {
  return joinClasses(
    'metrora-sidebar__collapsed-icon-bg',
    navInteractiveTransitionClassName,
    active ? 'is-active' : 'is-idle',
  )
}

export function sidebarCollapsedIconGlyphClassName(active: boolean): string {
  return joinClasses(
    'metrora-sidebar__collapsed-icon-glyph',
    active ? 'is-active' : 'is-idle',
  )
}

export function sidebarNavLabelClassName(collapsed: boolean): string {
  return joinClasses(
    'metrora-sidebar__label',
    collapsed && 'metrora-sr-only',
  )
}

export const SIDEBAR_ICON_BUTTON_CLASS = joinClasses(
  'metrora-sidebar__icon-button',
  navInteractiveTransitionClassName,
)
