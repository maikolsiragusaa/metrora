/*
 * Adapted from OpenHands/OpenHands
 * Original path: src/ui/divider.tsx
 * Exact source: 1a34e0222ee9e3c1f8c13fc16d28e69361a022ff
 * Licence: MIT; see LICENSES/OPENHANDS-MIT.txt
 * Metrora modification: kept the separator semantics and menu inset idea but
 * implemented orientation/inset styling with Metrora CSS instead of CVA and
 * Tailwind classes.
 */

export const MENU_DIVIDER_VERTICAL_CLASS = 'metrora-divider--menu'

export function Divider({
  orientation = 'horizontal',
  inset = 'none',
  className,
  testId,
}: {
  orientation?: 'horizontal' | 'vertical'
  inset?: 'none' | 'menu'
  className?: string
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      role="separator"
      aria-orientation={orientation}
      className={[
        'metrora-divider',
        `metrora-divider--${orientation}`,
        inset === 'menu' ? MENU_DIVIDER_VERTICAL_CLASS : '',
        className,
      ].filter(Boolean).join(' ')}
    />
  )
}
