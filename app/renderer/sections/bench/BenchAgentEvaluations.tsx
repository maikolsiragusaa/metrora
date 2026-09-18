import type { BenchView } from './benchTypes'

export function BenchAgentEvaluations({ onNavigate }: { onNavigate: (view: BenchView) => void }) {
  return (
    <div className="bench-detail">
      <nav className="bench-breadcrumb" aria-label="Bench location">
        <button type="button" className="bench-breadcrumb-link" onClick={() => onNavigate('overview')}>
          Bench
        </button>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Agent evaluations</span>
      </nav>

      <div className="bench-page-head">
        <div className="bench-title-row">
          <h1 className="bench-title">Agent evaluations</h1>
          <span className="bench-status-pill bench-status-pill-future">
            <span className="bench-status-dot" aria-hidden="true" />
            Future
          </span>
        </div>
        <p className="bench-subcopy">
          Evaluate the complete AI system — model, agent, tools, and environment — not just the underlying
          model.
        </p>
      </div>

      <section className="bench-card bench-card-wide" aria-labelledby="agent-flow">
        <div className="bench-card-head">
          <span className="bench-family-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="5" y="4" width="14" height="17" rx="2" />
              <path d="M9 11h6M9 15h6" />
            </svg>
          </span>
          <div>
            <h2 id="agent-flow">End-to-end evaluation flow</h2>
            <p>Agent evaluations measure how the full system works together to complete tasks in real environments.</p>
          </div>
        </div>
        <ol className="bench-flow" aria-label="Agent evaluation flow">
          <li>
            <strong>Model</strong>
            <span>Base model provides core capabilities</span>
          </li>
          <li aria-hidden="true" className="bench-flow-arrow">
            →
          </li>
          <li>
            <strong>Agent</strong>
            <span>Agent logic, planning and tool use</span>
          </li>
          <li aria-hidden="true" className="bench-flow-arrow">
            →
          </li>
          <li>
            <strong>Tools + Environment</strong>
            <span>Access to tools, APIs, and real or simulated environments</span>
          </li>
          <li aria-hidden="true" className="bench-flow-arrow">
            →
          </li>
          <li>
            <strong>Task</strong>
            <span>A well-defined goal or instruction</span>
          </li>
          <li aria-hidden="true" className="bench-flow-arrow">
            →
          </li>
          <li>
            <strong>Verifier</strong>
            <span>Evaluates the outcome for correctness, completeness, and quality</span>
          </li>
        </ol>
      </section>

      <div className="bench-three-col">
        <section className="bench-card" aria-labelledby="agent-framework">
          <div className="bench-card-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </span>
            <div>
              <h2 id="agent-framework">Candidate execution framework</h2>
            </div>
            <span className="bench-status-pill bench-status-pill-future">
              <span className="bench-status-dot" aria-hidden="true" />
              Future
            </span>
          </div>
          <p className="bench-card-copy">
            We are exploring Harbor as a candidate ecosystem for agent evaluations, providing orchestration,
            environment interfaces, and evaluation harnesses.
          </p>
          <div className="bench-candidate">
            <div>
              <span className="bench-candidate-label">Candidate ecosystem</span>
              <strong>Harbor</strong>
              <p>Agent execution and evaluation framework (for consideration)</p>
            </div>
          </div>
        </section>

        <section className="bench-card" aria-labelledby="agent-examples">
          <div className="bench-card-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="5" y="4" width="14" height="17" rx="2" />
                <path d="M9 11h6M9 15h6" />
              </svg>
            </span>
            <div>
              <h2 id="agent-examples">Example benchmark families</h2>
            </div>
            <span className="bench-status-pill bench-status-pill-future">
              <span className="bench-status-dot" aria-hidden="true" />
              Future
            </span>
          </div>
          <p className="bench-card-copy">
            We plan to support established agent benchmarks, including real-world software and terminal tasks.
          </p>
          <div className="bench-candidate">
            <div>
              <strong>SWE-bench</strong>
              <p>Real-world software engineering tasks (e.g. GitHub issues)</p>
            </div>
          </div>
          <div className="bench-candidate">
            <div>
              <strong>Terminal-Bench</strong>
              <p>Command-line and terminal-based tasks</p>
            </div>
          </div>
          <p className="bench-footnote">Examples only. Not an exhaustive list.</p>
        </section>

        <section className="bench-card" aria-labelledby="agent-identity">
          <div className="bench-card-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 19h16" />
                <path d="M6 17v-5M12 17V7M18 17v-9" />
              </svg>
            </span>
            <div>
              <h2 id="agent-identity">What results will identify</h2>
            </div>
            <span className="bench-status-pill bench-status-pill-future">
              <span className="bench-status-dot" aria-hidden="true" />
              Future
            </span>
          </div>
          <p className="bench-card-copy">
            Each evaluation run will record the key components and outcomes to ensure clear, reproducible comparisons.
          </p>
          <ul className="bench-neutral-list">
            <li>Model (name and version)</li>
            <li>Agent (framework and configuration)</li>
            <li>Benchmark (name and subset)</li>
            <li>Environment (e.g. OS, runtime, container)</li>
            <li>Tool access (enabled tools and permissions)</li>
            <li>Task version (specific task or commit)</li>
            <li>Result (pass/fail and/or evaluation output)</li>
            <li>Cost (total tokens and estimated cost)</li>
            <li>Duration (total execution time)</li>
          </ul>
        </section>
      </div>

      <div className="bench-info-banner" role="note">
        <span className="bench-family-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8v.1" />
          </svg>
        </span>
        <div>
          <strong>Agent evaluations score the full system</strong>
          <p>
            These evaluations measure the end-to-end performance of the model, agent, tools, and environment
            working together. They should not be confused with raw model benchmarks, which only measure the
            model&apos;s capabilities in isolation.
          </p>
        </div>
      </div>

      <button type="button" className="bench-inline-link" onClick={() => onNavigate('overview')}>
        ← Back to Bench Preview
      </button>
    </div>
  )
}
