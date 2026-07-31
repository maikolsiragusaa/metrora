import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { installPageHiddenClass } from './lib/pageVisibility'
import { migrateKnownStorage } from './lib/storage'
import './styles/indigo.css'
import './styles/plain.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

// Copy known CodeBurn-era settings to canonical Qovrion keys before any React
// state initializer reads them. Legacy keys are intentionally retained.
migrateKnownStorage()

// Pause looping CSS animations while the window is hidden/minimized (energy).
installPageHiddenClass()

// Tag the platform so CSS can adapt native chrome. Prefer the canonical bridge
// and retain the legacy bridge only as a compatibility fallback.
const desktopBridge = (window as unknown as {
  qovrion?: { platform?: string }
  codeburn?: { platform?: string }
}).qovrion ?? (window as unknown as { codeburn?: { platform?: string } }).codeburn
document.documentElement.dataset.platform = desktopBridge?.platform ?? ''

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
