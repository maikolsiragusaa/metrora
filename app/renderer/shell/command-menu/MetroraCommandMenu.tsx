import { useEffect, useMemo, useState } from 'react'

import {
  DESKTOP_NAVIGATION_ITEMS,
  DESKTOP_NAVIGATION_ORDER,
  type Section,
} from '../../lib/desktopNavigation'
import { ContextMenu } from '../../ui/primitives/ContextMenu'
import { Divider } from '../../ui/primitives/Divider'
import { MetroraModalButton } from '../../ui/primitives/MetroraModalButton'
import { Typography } from '../../ui/primitives/Typography'
import { MetroraDialog } from '../../ui/overlays/MetroraDialog'
import { MetroraModalBody } from '../../ui/overlays/MetroraModalBody'

export function MetroraCommandMenu({
  open,
  activeSection,
  onNavigate,
  onClose,
}: {
  open: boolean
  activeSection: Section
  onNavigate: (section: Section) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const filteredSections = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return DESKTOP_NAVIGATION_ORDER.filter(section => {
      if (!normalized) return true
      const item = DESKTOP_NAVIGATION_ITEMS[section]
      return `${item.label} ${item.title}`.toLocaleLowerCase().includes(normalized)
    })
  }, [query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const currentIndex = DESKTOP_NAVIGATION_ORDER.indexOf(activeSection)
    setActiveIndex(Math.max(0, currentIndex))
  }, [activeSection, open])

  useEffect(() => {
    if (filteredSections.length === 0) setActiveIndex(0)
    else setActiveIndex(index => Math.min(index, filteredSections.length - 1))
  }, [filteredSections])

  if (!open) return null

  const chooseActive = () => {
    const section = filteredSections[activeIndex]
    if (section) onNavigate(section)
  }

  return (
    <MetroraDialog
      ariaLabelledBy="metrora-command-menu-title"
      onClose={onClose}
      className="metrora-command-dialog"
    >
      <MetroraModalBody width="md" className="metrora-command-menu">
        <div className="metrora-command-menu__header">
          <div>
            <Typography variant="title" as="h2" id="metrora-command-menu-title">Navigate</Typography>
            <Typography variant="body" className="metrora-command-menu__hint">Find a Metrora surface or use the keyboard to move quickly.</Typography>
          </div>
          <MetroraModalButton
            text="×"
            variant="text-like"
            ariaLabel="Close navigation"
            className="metrora-command-menu__close"
            onClick={onClose}
          />
        </div>
        <input
          className="metrora-command-menu__input"
          type="search"
          value={query}
          placeholder="Search sections"
          aria-label="Search Metrora sections"
          data-metrora-dialog-autofocus="true"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex(index => filteredSections.length === 0 ? 0 : (index + 1) % filteredSections.length)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex(index => filteredSections.length === 0 ? 0 : (index - 1 + filteredSections.length) % filteredSections.length)
            } else if (event.key === 'Home') {
              event.preventDefault()
              setActiveIndex(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              setActiveIndex(Math.max(0, filteredSections.length - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              chooseActive()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
          }}
        />
        <Divider />
        {filteredSections.length > 0 ? (
          <ContextMenu
            role="listbox"
            ariaLabel="Metrora sections"
            theme="naked"
            className="metrora-command-menu__results"
          >
            {filteredSections.map((section, index) => {
              const item = DESKTOP_NAVIGATION_ITEMS[section]
              const selected = section === activeSection
              const highlighted = index === activeIndex
              return (
                <li
                  key={section}
                  role="option"
                  aria-selected={highlighted}
                  className={['metrora-command-menu__result', highlighted && 'is-highlighted', selected && 'is-current'].filter(Boolean).join(' ')}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onNavigate(section)}
                  >
                    <span className="metrora-command-menu__result-glyph" aria-hidden="true" />
                    <span>{item.label}</span>
                    {selected && <span className="metrora-command-menu__current">Current</span>}
                    {item.shortcut && <kbd>{item.shortcut}</kbd>}
                  </button>
                </li>
              )
            })}
          </ContextMenu>
        ) : (
          <Typography variant="body" className="metrora-command-menu__empty" role="status">No Metrora sections match “{query}”.</Typography>
        )}
        <div className="metrora-command-menu__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> open</span>
          <MetroraModalButton text="Close" variant="text-like" onClick={onClose} />
        </div>
      </MetroraModalBody>
    </MetroraDialog>
  )
}
