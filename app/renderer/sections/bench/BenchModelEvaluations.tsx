import type { BenchView } from './benchTypes'

export function BenchModelEvaluations({ onNavigate }: { onNavigate: (view: BenchView) => void }) {
  return (
    <div className="bench-detail">
      <nav className="bench-breadcrumb" aria-label="Bench location">
        <button type="button" className="bench-breadcrumb-link" onClick={() => onNavigate('overview')}>
          Bench
        </button>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Model evaluations</span>
      </nav>

      <div className="bench-page-head">
        <div className="bench-title-row">
          <h1 className="bench-title">Model evaluations</h1>
          <span className="bench-status-pill bench-status-pill-exploring">
            <span className="bench-status-dot" aria-hidden="true" />
            Exploring
          </span>
        </div>
        <p className="bench-subcopy">
          This area will evaluate model capability with established, versioned evaluation suites.
        </p>
      </div>

      <div className="bench-two-col">
        <section className="bench-card" aria-labelledby="model-what">
          <div className="bench-card-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="5" y="4" width="14" height="17" rx="2" />
                <path d="M9 4a3 3 0 0 1 6 0" />
              </svg>
            </span>
            <div>
              <h2 id="model-what">What this will measure</h2>
              <p>Evaluations will cover core model capabilities using established benchmarks.</p>
            </div>
          </div>
          <dl className="bench-definition-list">
            <div>
              <dt>Reasoning</dt>
              <dd>Logical deduction, multi-step problem solving, and complex reasoning tasks.</dd>
            </div>
            <div>
              <dt>Knowledge</dt>
              <dd>Factual recall and world knowledge across diverse domains.</dd>
            </div>
            <div>
              <dt>Instruction following</dt>
              <dd>Adherence to explicit instructions and ability to follow complex prompts.</dd>
            </div>
            <div>
              <dt>General capability</dt>
              <dd>Broad language understanding and task performance across disciplines.</dd>
            </div>
            <div>
              <dt>Multimodal capability</dt>
              <dd>Image, audio, or other modality understanding where supported by the suite.</dd>
            </div>
          </dl>
        </section>

        <section className="bench-card" aria-labelledby="model-engines">
          <div className="bench-card-head">
            <span className="bench-family-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </span>
            <div>
              <h2 id="model-engines">Evaluation engines under review</h2>
              <p>We are evaluating leading open evaluation frameworks for integration.</p>
            </div>
          </div>
          <div className="bench-candidate">
            <div>
              <strong>Inspect AI</strong>
              <p>A flexible evaluation framework for LLMs with a growing collection of standardized benchmarks, task suites, and analysis tools.</p>
            </div>
            <span className="bench-status-pill bench-status-pill-exploring">
              <span className="bench-status-dot" aria-hidden="true" />
              Candidate
            </span>
          </div>
          <div className="bench-candidate">
            <div>
              <strong>lm-evaluation-harness</strong>
              <p>A widely-adopted open source framework for running evaluations across many established LLM benchmarks and tasks.</p>
            </div>
            <span className="bench-status-pill bench-status-pill-exploring">
              <span className="bench-status-dot" aria-hidden="true" />
              Under evaluation
            </span>
          </div>
        </section>
      </div>

      <section className="bench-card bench-card-wide" aria-labelledby="model-method">
        <div className="bench-card-head">
          <span className="bench-family-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="5" y="4" width="14" height="17" rx="2" />
              <path d="M9 11h6M9 15h6" />
            </svg>
          </span>
          <div>
            <h2 id="model-method">Methodology</h2>
            <p>Results will remain attributable, transparent, and reproducible.</p>
          </div>
        </div>
        <dl className="bench-definition-list">
          <div>
            <dt>Benchmark identity</dt>
            <dd>We will clearly identify the benchmark or evaluation suite used (e.g., MMLU, GPQA, HumanEval).</dd>
          </div>
          <div>
            <dt>Dataset version</dt>
            <dd>The exact dataset version will be recorded and displayed.</dd>
          </div>
          <div>
            <dt>Model and configuration</dt>
            <dd>The evaluated model and its exact configuration (e.g., model version, decoding settings) will be documented.</dd>
          </div>
          <div>
            <dt>Suite version</dt>
            <dd>The version of the evaluation framework or harness will be tracked to ensure reproducibility.</dd>
          </div>
          <div>
            <dt>No universal score</dt>
            <dd>Metrora does not collapse results into a proprietary universal score. Results remain reported as defined by the original benchmark.</dd>
          </div>
        </dl>
      </section>

      <div className="bench-info-banner" role="note">
        <span className="bench-family-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3" />
          </svg>
        </span>
        <div>
          <strong>Integration has not been selected yet</strong>
          <p>We are assessing evaluation frameworks and designing the integration. This page is a preview of the planned functionality and is not executable yet.</p>
        </div>
      </div>

      <button type="button" className="bench-inline-link" onClick={() => onNavigate('overview')}>
        ← Back to Bench Preview
      </button>
    </div>
  )
}
