import type { ReactNode } from 'react'

import { MetroraMark } from '../MetroraMark'

export type StepId = 'welcome' | 'discover' | 'code' | 'companion' | 'ready'

export const ONBOARDING_STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'discover', label: 'Discover' },
  { id: 'code', label: 'Code' },
  { id: 'companion', label: 'Companion' },
  { id: 'ready', label: 'Ready' },
]

export type IconName =
  | 'arrow-right'
  | 'check'
  | 'code'
  | 'folder'
  | 'grid'
  | 'info'
  | 'link'
  | 'lock'
  | 'laptop'
  | 'person'
  | 'phone'
  | 'plus'
  | 'server'
  | 'shield'
  | 'database'

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'arrow-right':
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'check':
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>
    case 'code':
      return <svg {...common}><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" /></svg>
    case 'folder':
      return <svg {...common}><path d="M3.5 7.5h6l1.8 2H20a1 1 0 0 1 1 1v6.8a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.3V8a.5.5 0 0 1 .5-.5Z" /><path d="M3 10h18" /></svg>
    case 'grid':
      return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>
    case 'info':
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 10.5v5M12 7.5h.01" /></svg>
    case 'link':
      return <svg {...common}><path d="M10 13.8 8.7 15a3.1 3.1 0 1 1-4.4-4.4l2.8-2.8a3.1 3.1 0 0 1 4.4 0M14 10.2l1.3-1.2a3.1 3.1 0 1 1 4.4 4.4l-2.8 2.8a3.1 3.1 0 0 1-4.4 0M8.5 12h7" /></svg>
    case 'lock':
      return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
    case 'laptop':
      return <svg {...common}><rect x="4" y="4.5" width="16" height="11" rx="1.5" /><path d="M2.5 19.5h19" /></svg>
    case 'person':
      return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" /></svg>
    case 'phone':
      return <svg {...common}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M10.5 6h3M11 18h2" /></svg>
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
    case 'server':
      return <svg {...common}><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01M8 17h.01" /></svg>
    case 'shield':
      return <svg {...common}><path d="M12 3.5 19 6v5.5c0 4.2-2.8 7.5-7 9-4.2-1.5-7-4.8-7-9V6l7-2.5Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg>
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="6.5" rx="7" ry="3" /><path d="M5 6.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6M5 12.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></svg>
  }
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'onboarding-brand onboarding-brand-compact' : 'onboarding-brand'}>
      <span className="onboarding-brand-mark"><MetroraMark size={compact ? 55 : 72} /></span>
      <span className="onboarding-brand-name">Metrora</span>
    </div>
  )
}

export function OnboardingStepper({ current, onSelect }: { current: StepId; onSelect: (step: StepId) => void }) {
  const currentIndex = ONBOARDING_STEPS.findIndex(step => step.id === current)
  return (
    <ol className="onboarding-stepper" aria-label="Onboarding progress">
      {ONBOARDING_STEPS.map((step, index) => {
        const completed = index < currentIndex
        const active = step.id === current
        return (
          <li
            className={['onboarding-step', completed ? 'onboarding-step-done' : '', active ? 'onboarding-step-active' : ''].filter(Boolean).join(' ')}
            key={step.id}
          >
            <button
              type="button"
              className="onboarding-step-button"
              aria-current={active ? 'step' : undefined}
              aria-label={`Go to ${step.label}`}
              onClick={() => onSelect(step.id)}
            >
              <span className="onboarding-step-marker">{completed ? <Icon name="check" size={15} /> : <span />}</span>
              <span className="onboarding-step-label">{step.label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export function Feature({ icon, title, body, tone }: { icon: IconName; title: string; body: string; tone: string }) {
  return (
    <div className="onboarding-feature">
      <span className={`onboarding-feature-icon ${tone}`}><Icon name={icon} size={27} /></span>
      <span className="onboarding-feature-copy">
        <strong>{title}</strong>
        <span>{body}</span>
      </span>
    </div>
  )
}

export function PrimaryButton({ children, onClick, disabled = false, icon = 'arrow-right', className = '' }: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  icon?: IconName
  className?: string
}) {
  return (
    <button
      type="button"
      className={['onboarding-primary', className].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={23} />
      <span>{children}</span>
    </button>
  )
}
