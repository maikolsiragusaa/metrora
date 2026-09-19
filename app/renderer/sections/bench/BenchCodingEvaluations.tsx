import type { BenchView } from './benchTypes'

export function BenchCodingEvaluations({ onNavigate }: { onNavigate: (view: BenchView) => void }) {
  return (
    <div className="bench-detail">
      <nav className="bench-breadcrumb" aria-label="Bench location">
        <button type="button" className="bench-breadcrumb-link" onClick={() => onNavigate('overview')}>
          Bench
        </button>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Coding evaluations</span>
      </nav>

      <div className="bench-page-head bench-page-head-split">
        <div>
          <div className="bench-title-row">
            <h1 className="bench-title">Coding evaluations</h1>
            <span className="bench-status-pill bench-status-pill-future">
              <span className="bench-status-dot" aria-hidden="true" />
              Future
            </span>
          </div>
          <p className="bench-headline">Test coding ability with real, reproducible task suites.</p>
          <p className="bench-subcopy">
            This evaluation family is intended to measure how models solve programming tasks using established
            benchmarks and reproducible environments.
          </p>
        </div>
        <div className="bench-notice-card" role="note">
          <span className="bench-family-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m8.5 6-5 6 5 6" />
              <path d="m15.5 6 5 6-5 6" />
            </svg>
          </span>
          <div>
            <strong>Not available yet</strong>
            <p>This evaluation family is a future direction and is not executable yet.</p>
          </div>
        </div>
      </div>

      <div className="bench-two-col">
        <section className="bench-card" aria-labelledby="coding-what">
          <div className="bench-card-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="5" y="4" width="14" height="17" rx="2" />
                <path d="M9 11h6M9 15h6" />
              </svg>
            </span>
            <div>
              <h2 id="coding-what">What gets evaluated</h2>
              <p>A broad set of coding capabilities using established tasks.</p>
            </div>
          </div>
          <ul className="bench-neutral-list bench-neutral-list-titled">
            <li>
              <strong>Code generation</strong>
              <span>Generate correct, idiomatic, and efficient code from natural language prompts.</span>
            </li>
            <li>
              <strong>Correctness</strong>
              <span>Functional correctness against test cases and reference solutions.</span>
            </li>
            <li>
              <strong>Bug fixing</strong>
              <span>Identify and fix bugs in existing code.</span>
            </li>
            <li>
              <strong>Cross-language tasks</strong>
              <span>Evaluate performance across multiple programming languages.</span>
            </li>
            <li>
              <strong>Reproducible coding workflows</strong>
              <span>Run in standardized environments with consistent evaluation procedures.</span>
            </li>
          </ul>
        </section>

        <section className="bench-card" aria-labelledby="coding-ecosystem">
          <div className="bench-card-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </span>
            <div>
              <h2 id="coding-ecosystem">Candidate ecosystem</h2>
              <p>Built on established, community-recognized benchmarks.</p>
            </div>
          </div>
          <div className="bench-candidate">
            <div>
              <strong>EvalPlus</strong>
              <p>An improved and more robust evaluation of coding ability, with stronger test suites and reliability compared to original benchmarks.</p>
            </div>
            <span className="bench-status-pill bench-status-pill-exploring">
              <span className="bench-status-dot" aria-hidden="true" />
              Candidate
            </span>
          </div>
          <div className="bench-related">
            <p className="bench-related-title">Related benchmarks</p>
            <ul className="bench-neutral-list bench-neutral-list-titled">
              <li>
                <strong>HumanEval+</strong>
                <span>An extended version of HumanEval with more comprehensive test cases.</span>
              </li>
              <li>
                <strong>MBPP+</strong>
                <span>An improved version of the Mostly Basic Programming Problems benchmark with stronger and more reliable evaluation.</span>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <div className="bench-two-col">
        <section className="bench-card" aria-labelledby="coding-identity">
          <div className="bench-card-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <ellipse cx="12" cy="5" rx="8" ry="3" />
                <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
              </svg>
            </span>
            <div>
              <h2 id="coding-identity">Evaluation identity</h2>
              <p>Every run will be fully defined and reproducible.</p>
            </div>
          </div>
          <dl className="bench-definition-list">
            <div>
              <dt>Model and model version</dt>
              <dd>Exact model identifier and version used for generation.</dd>
            </div>
            <div>
              <dt>Benchmark and dataset version</dt>
              <dd>Specific benchmark (e.g., EvalPlus) and dataset release.</dd>
            </div>
            <div>
              <dt>Runtime environment</dt>
              <dd>Execution environment, dependencies, and configuration.</dd>
            </div>
            <div>
              <dt>Generation settings</dt>
              <dd>Decoding parameters and any model-specific settings.</dd>
            </div>
            <div>
              <dt>Pass/fail evidence</dt>
              <dd>Test results, logs, and verification artifacts for each task.</dd>
            </div>
          </dl>
        </section>

        <section className="bench-card" aria-labelledby="coding-separate">
          <div className="bench-card-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
                <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
              </svg>
            </span>
            <div>
              <h2 id="coding-separate">Separate from local Performance</h2>
              <p>Coding evaluations measure capability, not hardware speed.</p>
            </div>
          </div>
          <p className="bench-card-copy">
            Coding evaluations assess what models can do, while local Performance measures how fast they run
            on your hardware. These are complementary and remain separate areas in Metrora.
          </p>
          <div className="bench-info-banner bench-info-banner-inline" role="note">
            <p>Coding evaluations are intended to provide standardized, reproducible results that are independent of your local hardware performance.</p>
          </div>
        </section>
      </div>

      <button type="button" className="bench-inline-link" onClick={() => onNavigate('overview')}>
        ← Back to Bench Preview
      </button>
    </div>
  )
}
