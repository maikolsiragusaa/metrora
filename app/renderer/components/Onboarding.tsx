import { useState } from 'react'
import { createPortal } from 'react-dom'

import { motionClass } from '../lib/motion'
import { MetroraMark } from './MetroraMark'

type Screen = {
  title: string
  body: string
  glyph: React.ReactNode
}

const SCREENS: Screen[] = [
  {
    title: 'Every tool. One clear view.',
    body: 'Understand usage, cost, sessions and models across the AI tools already running on your machine.',
    glyph: <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M7 14v-3M11 14V8M15 14v-5M3 18h18" /></>,
  },
  {
    title: 'Local-first by default.',
    body: 'Metrora reads local usage records directly. This build sends no product telemetry and performs no inherited update checks.',
    glyph: <><rect x="4.5" y="10" width="15" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  },
  {
    title: 'Measure before you optimize.',
    body: 'Compare models, inspect cost drivers and find inefficient workflows without pretending estimates are exact.',
    glyph: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  },
]

/** Compatibility-shaped local onboarding. No consent toggle or network call. */
export function Onboarding({ onDone }: { defaultEnabled: boolean; onDone: (enabled: boolean) => void }) {
  const [step, setStep] = useState(0)
  const last = step === SCREENS.length - 1

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className={motionClass('onboard', 'onboard-in')} role="dialog" aria-label="Welcome to Metrora">
      <div className="onboard-card">
        <div className="onboard-glyph" aria-hidden>
          {last
            ? <MetroraMark size={40} />
            : <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{SCREENS[step].glyph}</svg>}
        </div>

        <h2 className="onboard-title">{SCREENS[step].title}</h2>
        <p className="onboard-body">{SCREENS[step].body}</p>

        <div className="onboard-controls">
          {step > 0 ? (
            <button type="button" className="onboard-btn" onClick={() => setStep(value => value - 1)}>Back</button>
          ) : <span className="onboard-btn-ghost" />}
          <div className="onboard-dots" aria-hidden>
            {SCREENS.map((_, index) => (
              <span key={index} className={index === step ? 'onboard-dot on' : 'onboard-dot'} />
            ))}
          </div>
          {last ? (
            <button type="button" className="onboard-btn primary" onClick={() => onDone(false)}>Get started</button>
          ) : (
            <button type="button" className="onboard-btn primary" onClick={() => setStep(value => value + 1)}>Next</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
