import { useEffect, useRef, useState } from 'react'
import type { AdvisorContextualScopeMode } from '../advisor/context'
import { periodLabel } from '../advisor/evidence'
import { advisorHarnessContext, advisorPinnedHarnessContext, UNPINNED_ADVISOR_HARNESS_CONTEXT, type AdvisorScope, type AdvisorScopePin } from '../advisor/types'
import { PERIOD_OPTIONS } from '../components/TopBar'
import type { Period } from '../lib/types'

const PERIODS: Array<{ value: Period; label: string }> = PERIOD_OPTIONS.map(option => ({ value: option.value as Period, label: option.label }))

export type HarnessContextPopoverProps = {
  projectOptions: Array<{ id: string; name: string }>
  modelOptions: string[]
  providerOptions: Array<{ id: string; label: string }>
  scope: AdvisorScope
  contextualScopeMode: AdvisorContextualScopeMode | null
  contextualOrigin: string | null
  scopeSummary: string
  onScopeChange: (update: (current: AdvisorScope) => AdvisorScope) => void
}

function compactSummary(scopeSummary: string, mode: AdvisorContextualScopeMode | null, scope: AdvisorScope): string {
  if (mode === 'capacity') return 'Provider capacity · All providers'
  if (mode === 'compare') return 'Compare · ' + scopeSummary
  const context = advisorHarnessContext(scope)
  if (context.mode !== 'pinned') return 'Context'
  const pinnedItems = [
    context.pins.includes('period') || context.pins.includes('range') ? periodLabel(scope) : null,
    context.pins.includes('project') ? scope.projectName : null,
    context.pins.includes('provider') ? scope.provider === 'all' ? 'All providers' : scope.provider : null,
    context.pins.includes('model') ? scope.model : null,
  ].filter((item): item is string => Boolean(item))
  return pinnedItems.length ? 'Pinned · ' + pinnedItems.join(' · ') : 'Pinned context'
}

function pinDimension(scope: AdvisorScope, dimension: AdvisorScopePin): AdvisorScope {
  const context = advisorHarnessContext(scope)
  return { ...scope, harnessContext: advisorPinnedHarnessContext(...context.pins, dimension) }
}

export function HarnessContextPopover({ projectOptions, modelOptions, providerOptions, scope, contextualScopeMode, contextualOrigin, scopeSummary, onScopeChange }: HarnessContextPopoverProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const harnessContext = advisorHarnessContext(scope)
  const pinned = harnessContext.mode === 'pinned'
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('mousedown', onPointerDown); document.removeEventListener('keydown', onKeyDown) }
  }, [open])
  return (
    <div className="harness-v3-context-anchor" ref={rootRef}>
      <button type="button" className="harness-v3-context-trigger" aria-label="Harness context" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'harness-context-popover' : undefined} onClick={() => setOpen(current => !current)}>
        <span className="harness-v3-context-trigger-label">{compactSummary(scopeSummary, contextualScopeMode, scope)}</span><span aria-hidden="true" className="harness-v3-chevron">⌄</span>
      </button>
      {open ? <div className="harness-v3-context-popover" id="harness-context-popover" role="dialog" aria-label="Harness context details">
        <div className="harness-v3-popover-head"><strong>{pinned ? 'Pinned conversation context' : 'Conversation context'}</strong><p>{pinned ? 'Pinned context stays restrictive until you choose a bounded change.' : 'Each question may choose its own bounded factual period; no period is preloaded for the conversation.'}</p></div>
        {contextualOrigin ? <p className="harness-v3-context-origin">From {contextualOrigin}</p> : null}
        {contextualScopeMode === 'capacity' ? <p className="harness-v3-context-authority">Provider-reported now · All providers; Project and history do not scope Capacity.</p> : <>
          <div className="harness-v3-context-fields">
            <label>Context<select aria-label="Harness context mode" value={harnessContext.mode} onChange={event => onScopeChange(current => ({ ...current, harnessContext: event.target.value === 'pinned' ? advisorPinnedHarnessContext('period') : UNPINNED_ADVISOR_HARNESS_CONTEXT }))}><option value="unpinned">Unpinned · choose per question</option><option value="pinned">Pinned · keep restrictive</option></select></label>
            {pinned ? <label>Period<select aria-label="Harness period" value={scope.period} onChange={event => onScopeChange(current => ({ ...pinDimension(current, 'period'), period: event.target.value as Period }))}>{PERIODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> : null}
            {contextualScopeMode === 'compare' ? <p className="harness-v3-context-authority">Compare uses period + provider; custom dates and Project are not part of Compare.</p> : <label>Project<select aria-label="Harness Project" value={scope.projectId} onChange={event => { const id = event.target.value; onScopeChange(current => pinDimension({ ...current, projectId: id, projectName: id === 'all' ? 'All projects' : projectOptions.find(option => option.id === id)?.name ?? id }, 'project')) }}><option value="all">All projects</option>{projectOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
            <label>Provider<select aria-label="Harness provider" value={scope.provider} onChange={event => onScopeChange(current => pinDimension({ ...current, provider: event.target.value }, 'provider'))}>{providerOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            <label>Model<select aria-label="Harness model" value={scope.model ?? ''} onChange={event => onScopeChange(current => pinDimension({ ...current, model: event.target.value || null }, 'model'))}><option value="">All models</option>{modelOptions.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
          </div>
        </>}
        <div className="harness-v3-context-footer"><span>{pinned ? periodLabel(scope) : 'Period chosen per question'}</span><span>{pinned || contextualScopeMode ? scopeSummary : 'No global period filter'}</span><span>Facts read-only · actions require confirmation</span></div>
      </div> : null}
    </div>
  )
}
