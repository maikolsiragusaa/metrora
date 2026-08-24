# Advisor ↔ Bench evidence integration V1 — implementation-ready design package

> **DESIGN ONLY — NOT IMPLEMENTED.** This package defines a future read-only evidence bridge. It does not add an Advisor tool, alter Bench records, or make model-quality claims today.

## Decision and authority boundary

The future bridge must consume the existing versioned Bench authorities without re-scoring, rewriting, or promoting them:

| Authority | Contract | What the Advisor bridge may read |
| --- | --- | --- |
| task pack | metrora.bench-task-pack.v1, core metrora.bench.core@1.0.0 | pack id/version/digest, task ids, bounded task status metadata |
| deterministic scorer | metrora.bench-scoring.v1 | pass/fail/malformed status, score, output digest and output length; never the output text |
| evaluation | metrora.bench-evaluation.v1 | selected/reported model, runtime, generation policy, timestamps, task summaries, aggregate counts, result digest |
| private history | metrora.bench-history.v1 | bounded records returned by the main-process history reader; invalid records remain diagnostics |
| comparison | metrora.bench-comparison.v1 | compatibility, reason, and deltas only when the existing comparator says the runs are compatible |
| Advisor tools | frozen AdvisorToolV1 | unchanged; this package may not add fields, names, or side effects to it |

Bench remains local-only and explicitly selected-model evidence. Its current core pack is six synthetic deterministic tasks scored by exact text, normalized text, exact number, exact JSON, and bounded JSON shape. It is not a leaderboard, a general evaluation, a purchasing guide, or proof of coding superiority.

The bridge must keep the existing split between the original BenchRunV1 contract and the newer task-pack/evaluation contract. It may not reinterpret the original run, infer scores from old text, or merge the two histories.

## Proposed future capability

Add a separate optional capability named AdvisorBenchEvidenceV1 rather than mutating AdvisorToolV1. The capability is read-only and may expose two bounded operations:

- listBenchEvidence: return recent, valid run facts filtered by exact pack/model/runtime identity;
- compareBenchEvidence: compare two explicit run ids through compareBenchEvaluationsV1 and return its compatibility reason and deltas.

A future main-process bridge should call the existing private history scanner and comparator, then return a purpose-built projection. The renderer and Advisor model must not read the Bench directory directly. The projection should include only:

- schema versions, pack id/version/digest, runner id/version, runtime id, selected model, run id, timestamps, status, aggregate counts, score numerator/denominator/value, task ids/statuses, bounded latency metrics, compatibility reason, and result digests;
- a source label such as “local Bench history” and the exact run ids needed for a user to inspect the evidence;
- null for unavailable score/latency values rather than fabricated zeroes.

It must exclude prompts, generated text, full provider payloads, local filesystem paths, API keys, raw error bodies, and any free-form field that could become an unbounded transcript. Invalid history should be reported as a bounded diagnostic state; it must not be silently repaired or treated as a zero-score run.

## Factual question boundary

Supported questions are narrow, explicit, and source-backed. Examples:

- “What was the latest recorded score for this exact model on the core pack?”
- “Which tasks passed, failed, timed out, or were unavailable in run X?”
- “Can these two explicit runs be compared under the same pack, runner, scorer, and generation policy?”
- “What were the recorded score and median latency deltas between run X and run Y?”

The answer must identify the run ids, pack/scoring identity, selected model, and whether the comparison was compatible. A compatible comparison is a factual side-by-side delta, not an ordering or recommendation. An incompatible comparison returns the existing reason (pack-mismatch, runner-mismatch, scoring-mismatch, or generation-mismatch) and no deltas.

Unsupported questions must remain unsupported:

- “Which model is best?” or “Which model should I buy?”
- “Which model is better at coding in general?”
- universal provider rankings, leaderboards, badges, quality scores, or purchase/workflow recommendations;
- treating one synthetic six-task pack as representative of production work;
- comparing runs with different packs, runner versions, scoring identities, generation parameters, or incomplete results as if they were equivalent;
- turning a timeout, unavailable runtime, cancelled run, or null score into a failed or passed answer without preserving its status.

Advisor may explain these limits and point to the recorded evidence. It may not make the prohibited inference through a differently worded prompt.

## Run and consent semantics

The first integration should be read-only over completed/private history. It must not allow an Advisor response to mutate Bench history, delete records, change retention, edit a task pack, or alter scoring. If a future UI adds “run Bench”, it must be an explicit user action showing the selected local Ollama model, fixed local endpoint, pack version, timeout, and privacy boundary. Advisor conversation text must never be silently turned into Bench prompts.

The current Bench runner is Ollama-local and uses one bounded request per task. A future external/BYOK Bench runner would require a new runner id and separately versioned evaluation/history compatibility rules; it must not masquerade as ollama-task-pack-v1.

## Compatibility and provenance rules

compareBenchEvaluationsV1 remains the sole comparison authority. Before exposing deltas, the bridge must preserve its checks for:

- exact pack id, version, and digest;
- exact runner id and version;
- matching task sequence/scoring identity;
- exact generation policy and parameters.

The projection may add a presentation-level evidenceFreshness or historyDiagnostic field, but it must not weaken compatibility. A missing or corrupt record makes the evidence unavailable; it does not authorize a best-effort comparison. A score value is meaningful only with its numerator, denominator, status, pack identity, and result digest.

For model identity, display the exact selected model string and distinguish it from a runtime-reported model string. Do not normalize aliases across providers or infer that two model ids refer to the same model. Do not use latency deltas to imply quality or price advantages.

## Main-process integration shape

    AdvisorBenchEvidenceV1 request
      -> main-process bridge validates operation and bounds
      -> scanBenchHistoryV1 / compareBenchEvaluationsV1
      -> redact to bounded evidence projection
      -> Advisor optional capability / UI evidence card

The bridge should accept explicit run ids for comparison, a bounded limit for listing, and exact filters for pack/model/runtime. It should reject arbitrary filesystem paths, arbitrary JSON predicates, raw task prompts, and free-form code. History reads should use the existing private-store lease/read path and should never bypass atomic-file validation.

The Advisor surface should present “recorded local Bench evidence” with a link or affordance to the local Bench screen. It should not present the evidence as an official benchmark, a universal ranking, a guarantee of future performance, or a reason to purchase a model.

## Implementation package and acceptance gates

A future implementation should be reviewed in this order:

1. define and test the standalone AdvisorBenchEvidenceV1 projection and operation schemas;
2. implement the main-process reader using the existing history scanner and comparator;
3. add corruption, retention, null-score, incompatible-run, and cross-runtime fixtures;
4. add the optional Advisor capability without changing AdvisorToolV1 or its tool-output bound;
5. add renderer evidence cards and navigation to the existing Bench desktop surface;
6. add public docs that state the synthetic/local/evidence limits.

Acceptance requires:

- the same input records produce the same projection and comparison result;
- no raw task prompt, generated output, API key, local path, or provider body crosses the bridge;
- invalid history is visible as a diagnostic and never silently dropped into a score;
- null scores remain null for timeout, unavailable, cancelled, and zero-attempt runs;
- incompatible comparisons return a reason and deltas: null;
- the existing Bench history retention, atomic write, duplicate, collision, and invalid-record behavior remains unchanged;
- Advisor tool conformance, privacy, and local-runtime regression tests remain green;
- a user can distinguish local Bench evidence from ordinary Advisor reasoning at every presentation point.

## Explicitly out of scope

No leaderboard, ranking, recommendation, purchase guidance, coding-superiority claim, remote benchmark, cross-provider normalization, automatic background runs, prompt capture, generated-text archive, mutation of AdvisorToolV1, or migration of original BenchRunV1 is part of this package.
