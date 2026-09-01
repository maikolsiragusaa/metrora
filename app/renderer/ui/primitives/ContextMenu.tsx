/*
 * Adapted from OpenHands/OpenHands
 * Original path: src/ui/context-menu.tsx
 * Exact source: 1a34e0222ee9e3c1f8c13fc16d28e69361a022ff
 * Licence: MIT; see LICENSES/OPENHANDS-MIT.txt
 * Metrora modification: reduced the component to a dependency-free list host
 * for shell menus and command results, with Metrora surface classes and an
 * explicit role contract for accessible consumers.
 */

import type { CSSProperties, KeyboardEventHandler, ReactNode, Ref } from 'react'

export function ContextMenu({
  children,
  className,
  style,
  onKeyDown,
  ref,
  role = 'menu',
  ariaLabel,
  testId,
  theme = 'default',
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  onKeyDown?: KeyboardEventHandler<HTMLUListElement>
  ref?: Ref<HTMLUListElement>
  role?: 'menu' | 'listbox'
  ariaLabel?: string
  testId?: string
  theme?: 'default' | 'naked' | 'popover'
}) {
  return (
    <ul
      ref={ref}
      data-testid={testId}
      role={role}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      style={style}
      className={[
        'metrora-context-menu',
        `metrora-context-menu--${theme}`,
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </ul>
  )
}
