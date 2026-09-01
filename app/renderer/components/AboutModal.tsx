import type { MouseEvent, ReactNode } from 'react'

import { version } from '../../package.json'
import { BUILD_STAMP } from '../lib/build'
import { metrora } from '../lib/ipc'
import { MetroraDialog } from '../ui/overlays/MetroraDialog'
import { MetroraModalButton } from '../ui/primitives/MetroraModalButton'
import { MetroraMark } from './MetroraMark'

export type SocialLink = {
  label: string
  url: string
  icon: ReactNode
}

function openExternal(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  event.preventDefault()
  void metrora.openExternal(url)
}

export function AboutModal({ socials, onClose }: { socials: SocialLink[]; onClose: () => void }) {
  return (
    <MetroraDialog
      ariaLabelledBy="about-modal-title"
      onClose={onClose}
      className="about-modal"
      backdropClassName="about-modal-backdrop"
    >
      <MetroraModalButton
        text=""
        icon={<span aria-hidden="true">×</span>}
        ariaLabel="Close About"
        className="about-modal-close"
        type="button"
        onClick={onClose}
      />
      <div className="about-modal-grid">
        <div className="about-modal-hero">
          <span className="about-modal-logo" aria-hidden="true"><MetroraMark size={52} /></span>
          <div className="about-modal-name" id="about-modal-title">Metrora</div>
          <div className="about-modal-version">v{version}</div>
          <div className="about-modal-build">{BUILD_STAMP}</div>
          <div className="about-modal-tagline">Local-first intelligence for AI usage, cost and efficiency.</div>
        </div>
        <div className="about-modal-side">
          <div className="about-modal-section">
            <div className="about-modal-section-title">Links</div>
            {socials.map(social => (
              <a
                className="about-modal-link"
                href={social.url}
                key={social.label}
                onClick={event => openExternal(event, social.url)}
              >
                {social.icon}
                <span>{social.label}</span>
                <span className="about-modal-external" aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
          <div className="about-modal-section about-modal-updates">
            <div className="about-modal-section-title">Updates</div>
            <p className="about-modal-update-note" role="status">
              Updates are handled by the active distribution channel. This build does not use a separate in-app updater.
            </p>
          </div>
        </div>
      </div>
      <div className="about-modal-credit">
        Metrora · Published by Vensent
      </div>
    </MetroraDialog>
  )
}
