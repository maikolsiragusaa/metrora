import { useRef } from 'react'

import { ConnectionQr } from '../components/ConnectionQr'
import { MetroraDialog } from '../ui/overlays/MetroraDialog'
import type { Polled } from '../hooks/usePolled'
import type { ShareStatus } from '../lib/types'
import {
  PAIRING_STEP_TOTAL,
  pairingStepNumber,
  usePairingStage,
} from './companionPairingStage'

import mark from '../../../assets/brand/metrora-mark.svg'

/**
 * The v002 pairing dialog: a presentation layer over the existing local
 * pairing state machine (see companionPairingStage.ts). The QR, the pending
 * request, the SAS code and the completion signal all come from the polled
 * ShareStatus bridge; the three dialog stages map to the three real phases
 * (scan → verify → paired) with no artificial steps.
 */
function DeviceGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></svg>
  )
}

function ShieldGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v5.5c0 4.4-2.4 7.6-8 9.5-5.6-1.9-8-5.1-8-9.5V6z" /></svg>
  )
}

/** Decorative desktop glyph for the verify motif: a monitor carrying the
 *  Metrora bars, drawn in the same stroke language as the device glyph. */
function MonitorGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
      <path d="M9.4 12.4V10M11.7 12.4V8.4M14.1 12.4V9.6M16.4 12.4v-1.8" />
    </svg>
  )
}

export function CompanionPairingDialog({
  shareStatus,
  onClose,
  onStart,
}: {
  shareStatus: Polled<ShareStatus>
  onClose: () => void
  /** Parent's real start action; its boolean result drives the retry stage. */
  onStart: () => Promise<boolean>
}) {
  const { stage, busy, actionError, approve, decline, retry } = usePairingStage(shareStatus, onStart)
  const data = shareStatus.data
  const primaryActionRef = useRef<HTMLButtonElement>(null)

  const step = pairingStepNumber(stage)
  const eyebrow = stage.kind === 'verify'
    ? 'Verify device'
    : stage.kind === 'complete'
      ? 'Pairing complete'
      : stage.kind === 'ended'
        ? (stage.reason === 'expired' ? 'Pairing request expired' : 'Pairing unavailable')
        : 'Connect a device'
  const title = stage.kind === 'verify'
    ? 'Verify your device'
    : stage.kind === 'complete'
      ? 'Device paired'
      : stage.kind === 'ended'
        ? (stage.reason === 'service-off'
          ? 'Pairing is not active'
          : stage.reason === 'expired'
            ? 'Pairing request expired'
            : 'Pairing failed')
        : 'Scan to connect'

  return (
    <MetroraDialog
      className="companion-dialog"
      ariaLabelledBy="companion-pairing-dialog-title"
      onClose={onClose}
      initialFocusRef={primaryActionRef}
      closeOnBackdropClick={false}
    >
      <div className="companion-dialog-head">
        <span className="companion-dialog-eyebrow">{eyebrow}</span>
        <span className="companion-dialog-meta">
          {step !== null && <span className="companion-dialog-step">{step} of {PAIRING_STEP_TOTAL}</span>}
          <i className="companion-dialog-divider" aria-hidden="true" />
          <button type="button" className="companion-dialog-close" aria-label="Close pairing dialog" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
      </div>

      <div className="companion-dialog-body" aria-live="polite">
        <h2 id="companion-pairing-dialog-title">{title}</h2>

        {stage.kind === 'scan' && (
          <>
            <p className="companion-dialog-sub">Open Metrora Companion on your Android and scan this QR code.</p>
            <div className="companion-qr-card">
              {data?.connectPayload ? (
                <>
                  <ConnectionQr payload={data.connectPayload} level="H" />
                  <span className="companion-qr-mark" aria-hidden="true"><img src={mark} alt="" /></span>
                </>
              ) : (
                <div className="companion-qr-placeholder" role="status">Preparing QR…</div>
              )}
              <span className="companion-qr-badge" aria-hidden="true"><DeviceGlyph /></span>
            </div>
            <span className="companion-encrypted-pill"><ShieldGlyph />Encrypted local pairing</span>
            <ol className="companion-dialog-hints">
              <li><i aria-hidden="true">1</i><span>Keep both devices on the same local network.</span></li>
              <li><i aria-hidden="true">2</i><span>Approve the connection on this computer.</span></li>
            </ol>
            {!data && shareStatus.error ? (
              <p className="companion-dialog-alert" role="alert">Unable to read local sharing state.</p>
            ) : (
              <div className="companion-dialog-waiting" role="status">
                <span className="companion-spinner" aria-hidden="true" />
                <div><b>Waiting for your phone…</b><span>This QR code is temporary.</span></div>
              </div>
            )}
            {data?.networkWarning && <p className="companion-warning" role="status">{data.networkWarning}</p>}
          </>
        )}

        {stage.kind === 'verify' && (
          <>
            <p className="companion-dialog-sub">Compare the security code on this computer and your phone.</p>
            <div className="companion-verify-device">
              <div className="companion-verify-art" aria-hidden="true">
                <span className="companion-device-icon"><DeviceGlyph /></span>
                <i className="companion-verify-dots" />
                <span className="companion-verify-monitor"><MonitorGlyph /></span>
              </div>
              <div className="companion-verify-copy"><b>{stage.name}</b><span>Pairing request</span></div>
            </div>
            <div className="companion-sas">
              <span className="companion-sas-label">Security code</span>
              <strong className="companion-sas-code" data-testid="companion-sas-code">{stage.code}</strong>
              <span className="companion-sas-hint">Shown on both devices.</span>
            </div>
            <p className="companion-verify-warn"><b>Only approve if the codes match.</b><span>If they differ, cancel and start again.</span></p>
            {actionError && <p className="companion-dialog-alert" role="alert">{actionError}</p>}
            <div className="companion-dialog-actions">
              <button
                type="button"
                ref={primaryActionRef}
                className="companion-btn companion-btn-secondary"
                disabled={busy}
                onClick={() => void decline(stage.id)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="companion-btn companion-btn-primary"
                disabled={busy}
                onClick={() => void approve(stage)}
              >
                {busy ? 'Responding…' : 'Codes match — approve'}
              </button>
            </div>
          </>
        )}

        {stage.kind === 'complete' && (
          <>
            <p className="companion-dialog-sub">Your Android device is now paired with Metrora.</p>
            <div className="companion-complete-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </div>
            <div className="companion-complete-device">
              <span className="companion-device-icon" aria-hidden="true"><DeviceGlyph /></span>
              <div><b>{stage.name}</b><span>Metrora Companion</span></div>
              <span className="companion-chip-paired"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Paired</span>
            </div>
            <div className="companion-complete-note">
              <ShieldGlyph />
              <div><b>Local &amp; encrypted</b><span>Your desktop stays in control.</span></div>
            </div>
            <button type="button" ref={primaryActionRef} className="companion-btn companion-btn-primary companion-btn-block" onClick={onClose}>Done</button>
            <p className="companion-complete-caption">You can manage this device from Companion.</p>
          </>
        )}

        {stage.kind === 'ended' && (
          <>
            <p className="companion-dialog-sub">
              {stage.reason === 'service-off'
                ? 'The local pairing service stopped. Nothing changed on your paired devices.'
                : stage.reason === 'expired'
                  ? 'The request is no longer pending. Scan the QR code again to retry.'
                  : stage.detail ?? 'The pairing operation could not be completed.'}
            </p>
            {actionError && <p className="companion-dialog-alert" role="alert">{actionError}</p>}
            <div className="companion-dialog-actions">
              <button type="button" className="companion-btn companion-btn-secondary" onClick={onClose}>Close</button>
              <button type="button" ref={primaryActionRef} className="companion-btn companion-btn-primary" onClick={() => void retry()}>
                {stage.reason === 'service-off' ? 'Restart pairing' : 'Scan again'}
              </button>
            </div>
          </>
        )}
      </div>

      {stage.kind === 'scan' && (
        <div className="companion-dialog-footer">
          <span className="companion-dialog-note"><ShieldGlyph />Your data stays on your desktop.</span>
          <button type="button" ref={primaryActionRef} className="companion-btn companion-btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      )}
      {stage.kind === 'verify' && (
        <div className="companion-dialog-footer companion-dialog-footer-only">
          <span className="companion-dialog-note"><ShieldGlyph />Your approval is required to finish pairing.</span>
        </div>
      )}
    </MetroraDialog>
  )
}
