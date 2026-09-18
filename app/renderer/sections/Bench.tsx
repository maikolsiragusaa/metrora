import { useCallback, useState } from 'react'

import { TopBar } from '../components/TopBar'
import { DESKTOP_SECTION_CAPABILITIES } from '../lib/desktopSections'
import { motionClass } from '../lib/motion'
import { AdvancedBench } from './bench/AdvancedBench'
import { BenchAgentEvaluations } from './bench/BenchAgentEvaluations'
import { BenchCodingEvaluations } from './bench/BenchCodingEvaluations'
import { BenchModelEvaluations } from './bench/BenchModelEvaluations'
import { BenchOverview } from './bench/BenchOverview'
import { BenchPerformance } from './bench/BenchPerformance'
import type { AdvancedBenchTab, BenchView } from './bench/benchTypes'

const BENCH_CAPABILITIES = DESKTOP_SECTION_CAPABILITIES.bench

export function Bench() {
  const [view, setView] = useState<BenchView>('overview')
  const [advancedTab, setAdvancedTab] = useState<AdvancedBenchTab>('performance')

  const navigate = useCallback((next: BenchView) => {
    setView(next)
  }, [])

  const openAdvanced = useCallback((tab: AdvancedBenchTab = 'performance') => {
    setAdvancedTab(tab)
    setView('advanced')
  }, [])

  return (
    <>
      <TopBar
        title={null}
        scope={undefined}
        period="today"
        onPeriodChange={() => {}}
        customRange={null}
        onRangeSelect={() => {}}
        provider="all"
        providerLabel="All providers"
        providerOptions={[{ value: 'all', label: 'All providers' }]}
        onProviderSelect={() => {}}
        configSource={null}
        onConfigSelect={() => {}}
        capabilities={BENCH_CAPABILITIES}
      />
      <div className={motionClass('body', 'section-fade')}>
        <main className="bench-surface" aria-label="Bench">
          {view === 'overview' ? (
            <BenchOverview onNavigate={navigate} />
          ) : view === 'performance' ? (
            <BenchPerformance onNavigate={navigate} onOpenAdvanced={() => openAdvanced('performance')} />
          ) : view === 'model-evaluations' ? (
            <BenchModelEvaluations onNavigate={navigate} />
          ) : view === 'coding-evaluations' ? (
            <BenchCodingEvaluations onNavigate={navigate} />
          ) : view === 'agent-evaluations' ? (
            <BenchAgentEvaluations onNavigate={navigate} />
          ) : (
            <AdvancedBench
              key={advancedTab}
              initialTab={advancedTab}
              onNavigate={navigate}
            />
          )}
        </main>
      </div>
    </>
  )
}
