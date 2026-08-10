import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { installPageHiddenClass } from './lib/pageVisibility'
import { migrateKnownStorage } from './lib/storage'
import './styles/indigo.css'
import './styles/plain.css'
import './styles/brand.css'
import './styles/navigation.css'
import './styles/overview-home.css'
import './styles/workspace.css'
import './styles/workspace-guidance.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

// Adopt any supported legacy settings before React state initializes.
migrateKnownStorage()

// Pause looping CSS animations while the window is hidden/minimized (energy).
installPageHiddenClass()

// Tag the platform so CSS can adapt native chrome.
const desktopBridge = (window as unknown as {
  metrora?: { platform?: string }
}).metrora
document.documentElement.dataset.platform = desktopBridge?.platform ?? ''

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
