import { useState, type ReactNode } from 'react'

import {
  DESKTOP_NAVIGATION_GROUPS,
  DESKTOP_NAVIGATION_ITEMS,
  type DesktopNavigationGroup,
  type Section,
} from '../lib/desktopNavigation'
import { metrora } from '../lib/ipc'
import { shortcutLabel } from '../lib/shortcuts'
import { AboutModal, type SocialLink } from './AboutModal'
import { MetroraMark } from './MetroraMark'

export type { Section } from '../lib/desktopNavigation'

const NAV_ICONS: Record<Section, ReactNode> = {
  overview: (
    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
  ),
  sessions: (
    <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="16" width="16" height="4" rx="1"/></svg>
  ),
  pullRequests: (
    <svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
  ),
  spend: (
    <svg viewBox="0 0 24 24"><line x1="6" y1="20" x2="6" y2="13" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="9" /></svg>
  ),
  optimize: (
    <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="3.4"/><path d="M10.5 3v1.7M10.5 16.3V18M3 10.5h1.7M16.3 10.5H18M5.3 5.3l1.2 1.2M14.5 14.5l1.2 1.2M15.7 5.3l-1.2 1.2M6.5 14.5l-1.2 1.2"/><line x1="15.5" y1="15.5" x2="20" y2="20"/></svg>
  ),
  models: (
    <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></svg>
  ),
  compare: (
    <svg viewBox="0 0 24 24"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/></svg>
  ),
  plans: (
    <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
  ),
  workspace: (
    <svg viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.5c0 4.6 2.9 7.7 7.5 9.5 4.6-1.8 7.5-4.9 7.5-9.5V6L12 3z"/><path d="M8.5 12h7M12 8.5v7"/></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
  ),
}

const SOCIALS: SocialLink[] = [
  {
    label: 'GitHub',
    url: 'https://github.com/maikolsiragusaa/metrora',
    icon: <svg viewBox="0 0 24 24"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" /></svg>,
  },
]

function NavigationItem({
  section,
  active,
  onNavigate,
}: {
  section: Section
  active: Section
  onNavigate: (section: Section) => void
}) {
  const item = DESKTOP_NAVIGATION_ITEMS[section]
  return (
    <button
      className={section === active ? 'ni on' : 'ni'}
      type="button"
      aria-current={section === active ? 'page' : undefined}
      onClick={() => onNavigate(section)}
    >
      {NAV_ICONS[section]}
      <span className="ni-label">{item.label}</span>
      <span className="k">{shortcutLabel(item.shortcut)}</span>
    </button>
  )
}

function NavigationGroup({
  group,
  active,
  onNavigate,
}: {
  group: DesktopNavigationGroup
  active: Section
  onNavigate: (section: Section) => void
}) {
  const labelId = group.label ? `nav-group-${group.id}` : undefined
  const fallbackLabel = DESKTOP_NAVIGATION_ITEMS[group.sections[0]!].label
  return (
    <div
      className={`nav-group nav-group-${group.id}`}
      role="group"
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : fallbackLabel}
    >
      {group.label ? <div className="nav-group-label" id={labelId}>{group.label}</div> : null}
      {group.sections.map(section => (
        <NavigationItem key={section} section={section} active={active} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

export function Sidebar({ active, onNavigate }: {
  active: Section
  onNavigate: (section: Section) => void
  status?: ReactNode
}) {
  const [aboutOpen, setAboutOpen] = useState(false)
  const primaryGroups = DESKTOP_NAVIGATION_GROUPS.filter(group => group.placement === 'primary')
  const utilityGroups = DESKTOP_NAVIGATION_GROUPS.filter(group => group.placement === 'utility')

  return (
    <>
      <nav className="sb" aria-label="Metrora navigation">
        <div className="app"><MetroraMark size={20} /><b>Metrora</b></div>
        <div className="nav-primary">
          {primaryGroups.map(group => (
            <NavigationGroup key={group.id} group={group} active={active} onNavigate={onNavigate} />
          ))}
        </div>
        <div className="push" />
        <div className="nav-utility">
          {utilityGroups.map(group => (
            <NavigationGroup key={group.id} group={group} active={active} onNavigate={onNavigate} />
          ))}
        </div>
        <div className="foot">
          <a className="about" href="#about" onClick={event => { event.preventDefault(); setAboutOpen(true) }}>About</a>
          <div className="social">
            {SOCIALS.map(social => (
              <a
                key={social.label}
                href={social.url}
                title={social.label}
                aria-label={social.label}
                onClick={event => { event.preventDefault(); void metrora.openExternal(social.url) }}
              >
                {social.icon}
              </a>
            ))}
          </div>
        </div>
      </nav>
      {aboutOpen ? <AboutModal socials={SOCIALS} onClose={() => setAboutOpen(false)} /> : null}
    </>
  )
}
