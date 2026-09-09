import { useRef, type PointerEvent } from 'react'

import { ProviderLogo } from './ProviderLogo'

export type ProviderFilterOption = { id: string; label: string; logoProvider?: string }

/**
 * One-row provider scope strip shared by the dense Sessions and Models
 * surfaces. Pointer dragging and wheel translation keep every detected
 * provider reachable without exposing a native scrollbar.
 */
export function ProviderFilterStrip({
  provider,
  providers,
  onProviderChange,
  ariaLabel,
  className = 'session-provider-filter',
}: {
  provider: string
  providers: ProviderFilterOption[]
  onProviderChange: (value: string) => void
  ariaLabel: string
  className?: string
}) {
  const dragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  if (providers.length === 0) return null

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) suppressClickRef.current = true
    dragRef.current = null
    event.currentTarget.classList.remove('is-dragging')
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      className={className}
      role="group"
      aria-label={ariaLabel}
      data-provider-strip="true"
      data-scroll-interaction="drag-or-wheel"
      onPointerDown={event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startScrollLeft: event.currentTarget.scrollLeft,
          moved: false,
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={event => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        const deltaX = event.clientX - drag.startX
        if (!drag.moved && Math.abs(deltaX) < 4) return
        if (!drag.moved) {
          drag.moved = true
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }
        event.currentTarget.classList.add('is-dragging')
        event.currentTarget.scrollLeft = drag.startScrollLeft - deltaX
        event.preventDefault()
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onClickCapture={event => {
        if (!suppressClickRef.current) return
        suppressClickRef.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
      onWheel={event => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.currentTarget.scrollLeft += event.deltaY
          event.preventDefault()
        }
      }}
    >
      <button type="button" className={provider === 'all' ? 'on' : undefined} aria-pressed={provider === 'all'} onClick={() => onProviderChange('all')}>
        <span className="session-provider-all-icon" aria-hidden="true">✦</span>
        All providers
      </button>
      {providers.map(entry => (
        <button key={entry.id} type="button" className={provider === entry.id ? 'on' : undefined} aria-pressed={provider === entry.id} onClick={() => onProviderChange(entry.id)}>
          <ProviderLogo provider={entry.logoProvider ?? entry.id} size={15} />
          {entry.label}
        </button>
      ))}
    </div>
  )
}
