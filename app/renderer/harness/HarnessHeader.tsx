import type { ComponentProps } from 'react'
import { MetroraMark } from '../components/MetroraMark'
import { HarnessContextPopover } from './HarnessContextPopover'
import { HarnessRuntimePopover } from './HarnessRuntimePopover'

export function HarnessHeader({ context, runtimeControls, onOpenHistory, historyOpen }: { context: ComponentProps<typeof HarnessContextPopover>; runtimeControls: ComponentProps<typeof HarnessRuntimePopover>; onOpenHistory: () => void; historyOpen: boolean }) {
  return (
    <header className="harness-v3-header" aria-label="Harness controls">
      <div className="harness-v3-header-identity"><MetroraMark size={22} /><div><h1>Harness</h1><p>One conversation for Metrora work</p></div></div>
      <div className="harness-v3-header-controls">
        <HarnessContextPopover {...context} />
        <HarnessRuntimePopover {...runtimeControls} />
        <button type="button" className="harness-v3-history-button" aria-expanded={historyOpen} aria-haspopup="dialog" onClick={onOpenHistory}><span aria-hidden="true">☷</span>History</button>
      </div>
    </header>
  )
}
