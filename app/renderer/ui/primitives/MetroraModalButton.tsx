/*
 * Adapted from OpenHands/OpenHands
 * Original path: src/components/shared/buttons/modal-button.tsx
 * Exact source: 1a34e0222ee9e3c1f8c13fc16d28e69361a022ff
 * Licence: MIT; see LICENSES/OPENHANDS-MIT.txt
 * Metrora modification: replaced clsx/Tailwind styling with Metrora-owned
 * variants and added an explicit accessible-label prop for icon-only modal
 * controls.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function MetroraModalButton({
  text,
  icon,
  variant = 'default',
  className,
  testId,
  ariaLabel,
  intent,
  ...props
}: {
  text: string
  icon?: ReactNode
  variant?: 'default' | 'text-like'
  className?: string
  testId?: string
  ariaLabel?: string
  intent?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children' | 'aria-label'>) {
  return (
    <button
      {...props}
      data-testid={testId}
      aria-label={ariaLabel}
      name={intent ? 'intent' : undefined}
      value={intent}
      className={[
        'metrora-modal-button',
        variant === 'text-like' ? 'is-text-like' : 'is-default',
        icon && 'has-icon',
        props.disabled && 'is-disabled',
        className,
      ].filter(Boolean).join(' ')}
    >
      {icon}
      {text}
    </button>
  )
}
