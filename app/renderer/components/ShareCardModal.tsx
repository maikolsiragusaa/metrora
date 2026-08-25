import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { metrora } from '../lib/ipc'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import {
  buildShareCardV1,
  rasterizeShareCardPngDataUrl,
  shareCardSvgDataUrl,
} from '../share-card'
import '../styles/share-card.css'

export type ShareCardModalProps = {
  payload: MenubarPayload
  period: Period
  range?: DateRange | null
  providerLabel: string
  projectScopeActive?: boolean
  projectScopeName?: string | null
  stale?: boolean
  onClose: () => void
}

export function ShareCardModal({
  payload,
  period,
  range = null,
  providerLabel,
  projectScopeActive = false,
  projectScopeName = null,
  stale = false,
  onClose,
}: ShareCardModalProps) {
  const [includeCost, setIncludeCost] = useState(false)
  const [includeProjectName, setIncludeProjectName] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: '', error: false })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const card = useMemo(() => buildShareCardV1({
    payload,
    period,
    range,
    providerLabel,
    projectScopeActive,
    projectScopeName,
    includeProjectName,
    includeCost,
    stale,
  }), [includeCost, includeProjectName, payload, period, projectScopeActive, projectScopeName, providerLabel, range, stale])

  const save = async () => {
    setSaving(true)
    setStatus({ text: '', error: false })
    try {
      const pngDataUrl = await rasterizeShareCardPngDataUrl(card)
      const saved = await metrora.saveShareCardPng('metrora-ai-recap.png', pngDataUrl)
      setStatus({ text: saved ? 'PNG saved.' : 'Save cancelled.', error: false })
    } catch (cause) {
      setStatus({ text: cause instanceof Error ? cause.message : 'Share card could not be saved.', error: true })
    } finally {
      setSaving(false)
    }
  }

  const disclosureProject = projectScopeActive
    ? includeProjectName && projectScopeName ? projectScopeName : 'Current Project scope (name hidden)'
    : 'All Projects'

  return createPortal(
    <div className="share-card-backdrop" onClick={onClose}>
      <div
        className="share-card-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-card-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="share-card-head">
          <div>
            <h2 id="share-card-title">Create share card</h2>
            <p>Preview the exact local disclosure before saving a PNG.</p>
          </div>
          <button className="share-card-close" type="button" aria-label="Close share card" onClick={onClose}>×</button>
        </div>

        <div className="share-card-body">
          <div className="share-card-preview-shell">
            <img src={shareCardSvgDataUrl(card)} alt="Metrora AI recap share card preview" />
            <p className="share-card-preview-note">The PNG is rendered from this same local preview. Nothing is uploaded.</p>
          </div>

          <aside className="share-card-disclosure" aria-label="Share card disclosure">
            <h3>Included in this card</h3>
            <ul className="share-card-disclosure-list">
              <li><span>Period</span><strong>{card.periodLabel}</strong></li>
              <li><span>Provider scope</span><strong>{card.providerScope}</strong></li>
              <li><span>Project scope</span><strong>{disclosureProject}</strong></li>
              <li><span>Calls</span><strong>{card.metrics.calls.toLocaleString('en-US')}</strong></li>
              <li><span>Sessions</span><strong>{card.metrics.sessions.toLocaleString('en-US')}</strong></li>
              <li><span>Top model</span><strong>{card.topModel?.name ?? 'Not available'}</strong></li>
            </ul>

            <label className="share-card-option">
              <input type="checkbox" checked={includeCost} onChange={event => setIncludeCost(event.target.checked)} />
              <div>
                Include exact spend
                <span>Off by default. Pricing coverage is shown when it is incomplete.</span>
              </div>
            </label>

            {projectScopeActive && (
              <label className="share-card-option">
                <input
                  type="checkbox"
                  checked={includeProjectName}
                  disabled={!projectScopeName}
                  onChange={event => setIncludeProjectName(event.target.checked)}
                />
                <div>
                  Include Project name
                  <span>{projectScopeName ? 'Off by default.' : 'Project name is unavailable for this scope.'}</span>
                </div>
              </label>
            )}

            <div className="share-card-privacy">
              Prompts, responses, repository identity, local paths, session IDs, provider account labels, quota and credentials are never included in ShareCardV1.
            </div>
          </aside>
        </div>

        <div className="share-card-actions">
          <div className={`share-card-status${status.error ? ' error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.text}</div>
          <div>
            <button className="btn" type="button" onClick={onClose} disabled={saving}>Cancel</button>{' '}
            <button className="btn btn-p" type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Rendering…' : 'Save PNG'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
