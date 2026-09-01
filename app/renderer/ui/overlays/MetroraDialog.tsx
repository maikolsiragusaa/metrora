/*
 * Adapted from OpenHands/OpenHands
 * Original path: src/components/shared/modals/modal-backdrop.tsx
 * Exact source: 1a34e0222ee9e3c1f8c13fc16d28e69361a022ff
 * Licence: MIT; see LICENSES/OPENHANDS-MIT.txt
 * Metrora modification: retained portal, Escape, backdrop-click and stacking
 * behavior, then added Metrora focus acquisition/restoration, a small focus
 * trap, labelled-dialog props, and dependency-free semantic classes.
 */

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function MetroraDialog({
  children,
  onClose,
  closeOnEscape = true,
  closeOnBackdropClick = true,
  elevated = false,
  ariaLabel,
  ariaLabelledBy,
  className,
  backdropClassName,
  initialFocusRef,
}: {
  children: ReactNode
  onClose?: () => void
  closeOnEscape?: boolean
  closeOnBackdropClick?: boolean
  elevated?: boolean
  ariaLabel?: string
  ariaLabelledBy?: string
  className?: string
  backdropClassName?: string
  initialFocusRef?: RefObject<HTMLElement | null>
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = initialFocusRef?.current
      ?? dialogRef.current?.querySelector<HTMLElement>('[data-metrora-dialog-autofocus]')
      ?? dialogRef.current

    const focusId = window.setTimeout(() => target?.focus(), 0)
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!closeOnEscape) return
        event.preventDefault()
        onClose?.()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusId)
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [closeOnEscape, initialFocusRef, onClose])

  if (typeof document === 'undefined') return null

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdropClick && event.target === event.currentTarget) onClose?.()
  }

  return createPortal(
    <div className={['metrora-dialog-layer', elevated && 'is-elevated', backdropClassName].filter(Boolean).join(' ')}>
      <div
        className="metrora-dialog-backdrop"
        aria-hidden="true"
        onClick={handleBackdropClick}
      />
      <div className="metrora-dialog-positioner">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          tabIndex={-1}
          className={['metrora-dialog', className].filter(Boolean).join(' ')}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Escape' && closeOnEscape) {
              event.preventDefault()
              event.stopPropagation()
              onClose?.()
            }
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
