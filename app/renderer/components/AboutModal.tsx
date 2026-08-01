import { useEffect, type MouseEvent, type ReactNode } from 'react'

import { version } from '../../package.json'
import { BUILD_STAMP } from '../lib/build'
import { codeburn } from '../lib/ipc'
import { MetroraMark } from './MetroraMark'

export type SocialLink = {
  label: string
  url: string
  icon: ReactNode
}

function openExternal(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  event.preventDefault()
  void codeburn.openExternal(url)
}

export function AboutModal({ socials, onClose }: { socials: SocialLink[]; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="about-modal-backdrop" onClick={onClose}>
      <div
        className="about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        onClick={event => event.stopPropagation()}
      >
        <button className="about-modal-close" type="button" aria-label="Close About" onClick={onClose}>×</button>
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
                Metrora does not yet publish an automatic update channel. This build never checks or downloads CodeBurn releases.
              </p>
            </div>
          </div>
        </div>
        <div className="about-modal-credit">
          Independent Metrora build · Based on CodeBurn 0.9.19 under the MIT License
        </div>
      </div>
    </div>
  )
}
