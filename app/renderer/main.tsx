import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { installPageHiddenClass } from './lib/pageVisibility'
import './styles/indigo.css'
import './styles/plain.css'
import './styles/brand.css'
import './styles/navigation.css'
import './styles/overview-home.css'
import './styles/bench.css'
import './styles/workspace.css'
import './styles/workspace-guidance.css'
import './ui/tokens.css'
import './shell/metrora-shell.css'
import './styles/opencode.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

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
