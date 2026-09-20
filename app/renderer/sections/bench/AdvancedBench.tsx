import { useState } from 'react'

import { PerformanceBenchSection } from './PerformanceBenchSection'
import type { AdvancedBenchTab, BenchView } from './benchTypes'
import { CompatibilityBenchSection } from './CompatibilityBenchSection'
import { useCompatibilityBench } from './useCompatibilityBench'
import { usePerformanceBench } from './usePerformanceBench'

function AdvancedPerformanceTab() {
  const controller = usePerformanceBench()
  return (
    <PerformanceBenchSection
      history={controller.history}
      invalidCount={controller.invalidCount}
      loading={controller.loading}
      executablePath={controller.executablePath}
      modelPath={controller.modelPath}
      running={controller.running}
      comparison={controller.comparison}
      comparisonLoading={controller.comparisonLoading}
      leftRunId={controller.leftRunId}
      rightRunId={controller.rightRunId}
      onChooseExecutable={() => controller.chooseFile('llama-bench')}
      onChooseModel={() => controller.chooseFile('gguf')}
      onRun={() => controller.run()}
      onCancel={() => controller.cancel()}
      onLeftRunChange={controller.setLeftRunId}
      onRightRunChange={controller.setRightRunId}
    />
  )
}

function AdvancedCompatibilityTab() {
  // Mounting this tab is what triggers Compatibility reads; Overview and
  // Performance never mount it.
  return <CompatibilityBenchSection />
}

// Keep hooks referenced so lazy-loading tests can assert tab-level isolation
// without rendering both tabs at once.
void useCompatibilityBench

export function AdvancedBench({
  initialTab = 'performance',
  onNavigate,
}: {
  initialTab?: AdvancedBenchTab
  onNavigate: (view: BenchView) => void
}) {
  const [tab, setTab] = useState<AdvancedBenchTab>(initialTab)

  return (
    <div className="bench-detail">
      <nav className="bench-breadcrumb" aria-label="Bench location">
        <button type="button" className="bench-breadcrumb-link" onClick={() => onNavigate('overview')}>
          Bench
        </button>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Advanced</span>
      </nav>

      <div className="bench-page-head bench-page-head-split">
        <div>
          <div className="bench-title-row">
            <h1 className="bench-title">Advanced Bench</h1>
            <span className="bench-status-pill bench-status-pill-advanced">Advanced</span>
          </div>
          <p className="bench-subcopy">
            Configure and run technical benchmark tools for local model evaluation. Advanced Bench provides
            direct access to llama-bench and related tooling for experienced users.
          </p>
        </div>
        <button type="button" className="bench-ghost-button" onClick={() => onNavigate('overview')}>
          ← Back to Bench Preview
        </button>
      </div>

      <div className="bench-tabs" role="tablist" aria-label="Advanced Bench tools">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'performance'}
          className={tab === 'performance' ? 'bench-tab bench-tab-active' : 'bench-tab'}
          onClick={() => setTab('performance')}
        >
          Performance
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'compatibility'}
          className={tab === 'compatibility' ? 'bench-tab bench-tab-active' : 'bench-tab'}
          onClick={() => setTab('compatibility')}
        >
          Compatibility
        </button>
      </div>

      <div role="tabpanel" aria-label={tab === 'performance' ? 'Advanced Performance' : 'Advanced Compatibility'}>
        {tab === 'performance' ? <AdvancedPerformanceTab /> : <AdvancedCompatibilityTab />}
      </div>

      <button type="button" className="bench-inline-link" onClick={() => onNavigate('overview')}>
        ← Back to Bench Preview
      </button>
    </div>
  )
}
