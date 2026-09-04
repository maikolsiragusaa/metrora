import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  DESKTOP_NAVIGATION_GROUPS,
  DESKTOP_NAVIGATION_ITEMS,
  type DesktopNavigationGroup,
  type Section,
} from '../../lib/desktopNavigation'
import { metrora } from '../../lib/ipc'
import { readStorage, writeStorage } from '../../lib/storage'
import { shortcutLabel } from '../../lib/shortcuts'
import { MetroraCommandMenu } from '../command-menu/MetroraCommandMenu'
import { MetroraMark } from '../../components/MetroraMark'
import { AboutModal, type SocialLink } from '../../components/AboutModal'
import { Divider } from '../../ui/primitives/Divider'
import {
  SIDEBAR_ICON_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_CLASS,
  sidebarHeaderRowClassName,
  sidebarNavLabelClassName,
  sidebarNavListClassName,
  sidebarNavRowClassName,
} from '../../ui/primitives/sidebar-layout'
import { SidebarIconSlot } from './SidebarIconSlot'

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
  code: (
    <svg viewBox="0 0 24 24"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/><path d="M8 11h8M8 14h5"/></svg>
  ),
  bench: (
    <svg viewBox="0 0 24 24"><path d="M4 19h16"/><path d="M6 17v-5M12 17V7M18 17v-9"/><path d="M4 5h16"/></svg>
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
  collapsed,
  onNavigate,
}: {
  section: Section
  active: Section
  collapsed: boolean
  onNavigate: (section: Section) => void
}) {
  const item = DESKTOP_NAVIGATION_ITEMS[section]
  const shortcut = item.shortcut ? shortcutLabel(item.shortcut) : ''
  const isActive = section === active
  return (
    <button
      type="button"
      className={[sidebarNavRowClassName({ collapsed }), isActive ? 'on' : SIDEBAR_ROW_INTERACTIVE_CLASS.idle].join(' ')}
      aria-label={`${item.label}${shortcut ? ` ${shortcut}` : ''}`}
      aria-current={isActive ? 'page' : undefined}
      title={`${item.label}${shortcut ? ` · ${shortcut}` : ''}`}
      data-section={section}
      onClick={() => onNavigate(section)}
    >
      {collapsed ? (
        <SidebarIconSlot active={isActive}>{NAV_ICONS[section]}</SidebarIconSlot>
      ) : (
        <span className={SIDEBAR_ICON_SLOT_CLASS}>{NAV_ICONS[section]}</span>
      )}
      <span className={sidebarNavLabelClassName(collapsed)}>{item.label}</span>
      {shortcut && <span className={collapsed ? 'metrora-sr-only' : 'k'}>{shortcut}</span>}
    </button>
  )
}

function NavigationGroup({
  group,
  active,
  collapsed,
  onNavigate,
}: {
  group: DesktopNavigationGroup
  active: Section
  collapsed: boolean
  onNavigate: (section: Section) => void
}) {
  const labelId = group.label ? `metrora-nav-group-${group.id}` : undefined
  const fallbackLabel = DESKTOP_NAVIGATION_ITEMS[group.sections[0]!].label
  return (
    <div
      className={`nav-group nav-group-${group.id} metrora-sidebar__nav-group`}
      role="group"
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : fallbackLabel}
    >
      {group.label ? <div className={collapsed ? 'nav-group-label metrora-sr-only' : 'nav-group-label'} id={labelId}>{group.label}</div> : null}
      {group.sections.map(section => (
        <NavigationItem key={section} section={section} active={active} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

export function MetroraSidebar({
  active,
  onNavigate,
  status,
  initialCollapsed,
  onCollapsedChange,
}: {
  active: Section
  onNavigate: (section: Section) => void
  status?: ReactNode
  initialCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}) {
  const [collapsed, setCollapsed] = useState(() => initialCollapsed ?? readStorage('sidebar.collapsed') === 'true')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const navigationScrollRef = useRef<HTMLDivElement>(null)
  const commandShortcut = shortcutLabel('K')
  const primaryGroups = DESKTOP_NAVIGATION_GROUPS.filter(group => group.placement === 'primary')
  const utilityGroups = DESKTOP_NAVIGATION_GROUPS.filter(group => group.placement === 'utility')

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [])

  useEffect(() => {
    const activeItem = navigationScrollRef.current?.querySelector<HTMLElement>(`[data-section="${active}"]`)
    activeItem?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active, collapsed])

  const toggleCollapsed = () => {
    setCollapsed(current => {
      const next = !current
      writeStorage('sidebar.collapsed', String(next))
      onCollapsedChange?.(next)
      return next
    })
  }

  return (
    <aside className="metrora-sidebar" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="metrora-sidebar__surface">
        <div className={sidebarHeaderRowClassName(collapsed)} data-sidebar-region="header">
          <div className="metrora-sidebar__brand app" title="Metrora">
            <MetroraMark size={24} />
            <span className={sidebarNavLabelClassName(collapsed)}>Metrora</span>
          </div>
          <button
            type="button"
            className="metrora-sidebar__collapse-button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={collapsed ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'} /></svg>
          </button>
        </div>

        <button
          type="button"
          className="metrora-sidebar__search"
          data-sidebar-region="search"
          aria-label="Search sections"
          title={`Search sections (${commandShortcut})`}
          onClick={() => setCommandOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
          <span className={sidebarNavLabelClassName(collapsed)}>Search</span>
          <kbd className={collapsed ? 'metrora-sr-only' : ''}>{commandShortcut}</kbd>
        </button>

        <Divider className="metrora-sidebar__divider" />
        <nav aria-label="Metrora navigation" className="metrora-sidebar__navigation" data-sidebar-region="navigation">
          <div ref={navigationScrollRef} className="metrora-sidebar__nav-scroll" data-sidebar-region="navigation-scroll">
            <div className="nav-primary metrora-sidebar__nav-primary">
              {primaryGroups.map(group => (
                <NavigationGroup key={group.id} group={group} active={active} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
          <div className="metrora-sidebar__nav-utility-region" data-sidebar-region="utility">
            <div className="nav-utility metrora-sidebar__nav-utility">
              {utilityGroups.map(group => (
                <NavigationGroup key={group.id} group={group} active={active} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        </nav>

        {status !== undefined && <div className="metrora-sidebar__status status" data-sidebar-region="status" aria-live="polite">{status}</div>}
        <Divider className="metrora-sidebar__divider metrora-sidebar__footer-divider" />
        <div className="metrora-sidebar__footer foot" data-sidebar-region="footer">
          <a
            className="about"
            href="#about"
            title="About Metrora"
            onClick={event => { event.preventDefault(); setAboutOpen(true) }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10.5v5M12 7.5h.01" /></svg>
            <span className={sidebarNavLabelClassName(collapsed)}>About</span>
          </a>
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
      </div>

      {aboutOpen ? <AboutModal socials={SOCIALS} onClose={() => setAboutOpen(false)} /> : null}
      <MetroraCommandMenu
        open={commandOpen}
        activeSection={active}
        onClose={() => setCommandOpen(false)}
        onNavigate={section => { setCommandOpen(false); onNavigate(section) }}
      />
    </aside>
  )
}
