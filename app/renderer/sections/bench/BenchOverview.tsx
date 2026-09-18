import type { BenchView } from './benchTypes'

function StatusBadge({ tone, label }: { tone: 'available' | 'exploring' | 'future' | 'preview'; label: string }) {
  return (
    <span className={`bench-status-pill bench-status-pill-${tone}`}>
      <span className="bench-status-dot" aria-hidden="true" />
      {label}
    </span>
  )
}

export function BenchOverview({ onNavigate }: { onNavigate: (view: BenchView) => void }) {
  return (
    <div className="bench-overview">
      <div className="bench-page-head">
        <div className="bench-title-row">
          <h1 className="bench-title">Bench</h1>
          <StatusBadge tone="preview" label="Preview" />
        </div>
        <p className="bench-headline">Evaluate models and AI systems with reproducible evidence.</p>
        <p className="bench-subcopy">
          Bench measures local performance today and is expanding toward model, coding, and agent
          evaluations built around established benchmark ecosystems.
        </p>
      </div>

      <div className="bench-family-grid">
        <article className="bench-family-card bench-family-card-primary" aria-labelledby="bench-card-performance">
          <div className="bench-family-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 19h16" />
                <path d="M6 17v-5M12 17V7M18 17v-9" />
                <path d="M4 5h16" />
              </svg>
            </span>
            <div>
              <h2 id="bench-card-performance">Performance</h2>
              <p>Measure real performance on your local hardware.</p>
            </div>
            <StatusBadge tone="available" label="Available" />
          </div>
          <ul className="bench-check-list">
            <li>Local hardware performance measurements</li>
            <li>Prefill throughput and generation throughput</li>
            <li>Runtime and configuration evidence</li>
            <li>Comparable retained runs</li>
          </ul>
          <p className="bench-card-foot">Current foundation: llama.cpp / llama-bench</p>
          <button
            type="button"
            className="bench-primary-button"
            onClick={() => onNavigate('performance')}
          >
            Open Performance <span aria-hidden="true">→</span>
          </button>
        </article>

        <article className="bench-family-card" aria-labelledby="bench-card-model">
          <div className="bench-family-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="5" y="4" width="14" height="17" rx="2" />
                <path d="M9 4a3 3 0 0 1 6 0" />
                <path d="M9 11h6M9 15h6" />
              </svg>
            </span>
            <div>
              <h2 id="bench-card-model">Model evaluations</h2>
              <p>Evaluate model capability on established benchmarks.</p>
            </div>
            <StatusBadge tone="exploring" label="Exploring" />
          </div>
          <ul className="bench-neutral-list">
            <li>Standard evaluation suites and tasks</li>
            <li>Comparable, reproducible results</li>
            <li>Model capability across domains</li>
            <li>Growing set of benchmarks</li>
          </ul>
          <p className="bench-card-foot">Candidates: Inspect AI · lm-evaluation-harness</p>
          <button
            type="button"
            className="bench-ghost-button"
            onClick={() => onNavigate('model-evaluations')}
          >
            Preview model evaluations <span aria-hidden="true">→</span>
          </button>
        </article>

        <article className="bench-family-card" aria-labelledby="bench-card-coding">
          <div className="bench-family-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="m8.5 6-5 6 5 6" />
                <path d="m15.5 6 5 6-5 6" />
              </svg>
            </span>
            <div>
              <h2 id="bench-card-coding">Coding evaluations</h2>
              <p>Test coding ability with real, reproducible tasks.</p>
            </div>
            <StatusBadge tone="future" label="Future" />
          </div>
          <ul className="bench-neutral-list">
            <li>Reproducible coding tasks and problem sets</li>
            <li>Correctness-oriented evaluation</li>
            <li>Support for multiple languages and task types</li>
            <li>Integration with established benchmarks</li>
          </ul>
          <p className="bench-card-foot">Candidate: EvalPlus</p>
          <button
            type="button"
            className="bench-ghost-button"
            onClick={() => onNavigate('coding-evaluations')}
          >
            Preview coding evaluations <span aria-hidden="true">→</span>
          </button>
        </article>

        <article className="bench-family-card" aria-labelledby="bench-card-agent">
          <div className="bench-family-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <path d="M3.3 7 12 12l8.7-5M12 22V12" />
              </svg>
            </span>
            <div>
              <h2 id="bench-card-agent">Agent evaluations</h2>
              <p>Evaluate the complete system: model, agent, tools, and environment.</p>
            </div>
            <StatusBadge tone="future" label="Future" />
          </div>
          <ul className="bench-neutral-list">
            <li>End-to-end task completion and tool use</li>
            <li>Realistic, multi-step workflows</li>
            <li>Reproducible environments and evaluation criteria</li>
            <li>Growing ecosystem of agent benchmarks</li>
          </ul>
          <p className="bench-card-foot">
            Candidate ecosystem: Harbor
            <br />
            Examples: SWE-bench · Terminal-Bench
          </p>
          <button
            type="button"
            className="bench-ghost-button"
            onClick={() => onNavigate('agent-evaluations')}
          >
            Preview agent evaluations <span aria-hidden="true">→</span>
          </button>
        </article>
      </div>

      <div className="bench-methodology-strip">
        <span className="bench-family-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="5" y="4" width="14" height="17" rx="2" />
            <path d="M9 4a3 3 0 0 1 6 0" />
            <path d="M9 11h6M9 15h6" />
          </svg>
        </span>
        <div>
          <strong>Established benchmarks. Transparent methodology.</strong>
          <p>
            Metrora preserves the benchmark, harness, model, runtime, configuration, and methodology
            instead of collapsing everything into a proprietary universal score.
          </p>
        </div>
      </div>

      <div className="bench-advanced-row">
        <span className="bench-family-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </span>
        <div>
          <strong>Advanced local Bench</strong>
          <p>Advanced tools for current local Performance and Compatibility workflows remain available for experienced users.</p>
        </div>
        <span className="bench-status-pill bench-status-pill-available">
          <span className="bench-status-dot" aria-hidden="true" />
          Available
        </span>
        <button type="button" className="bench-primary-button" onClick={() => onNavigate('advanced')}>
          Open Advanced Bench <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  )
}
