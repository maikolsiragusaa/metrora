/*
 * Adapted from OpenHands/OpenHands
 * Original path: src/components/shared/modals/modal-body.tsx
 * Exact source: 1a34e0222ee9e3c1f8c13fc16d28e69361a022ff
 * Licence: MIT; see LICENSES/OPENHANDS-MIT.txt
 * Metrora modification: kept the bounded modal width contract while replacing
 * upstream surface classes with Metrora-owned semantic classes and CSS.
 */

import type { ReactNode } from 'react'

export type MetroraModalWidth = 'sm' | 'md' | 'lg' | 'xl'

export function MetroraModalBody({
  children,
  className,
  width = 'sm',
  testId,
}: {
  children: ReactNode
  className?: string
  width?: MetroraModalWidth
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className={['metrora-modal-body', `metrora-modal-body--${width}`, className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
