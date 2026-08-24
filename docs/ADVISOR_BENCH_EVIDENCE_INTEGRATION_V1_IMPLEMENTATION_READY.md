# Metrora Advisor ↔ Bench Evidence V1 — implementation-ready contract

Status: Lane A implementation on `feat/advisor-local-intelligence-v2`.

## Authority rule

Bench owns the controlled result. Advisor explains it. Advisor never creates, edits, deletes, rescored, or starts a Bench run from conversation, and it never mutates the frozen `AdvisorToolV1` contract.

The optional read-only capability is `AdvisorBenchEvidenceV1`. It reads canonical Bench history and canonical comparison through the existing bridge, then projects only bounded facts needed for explanation.

## Projection

The projection is deterministic and capped at 10 runs and 64 tasks per run. It includes:

- run id;
- task-pack id, version, and digest;
- scorer id/version (`metrora.bench-scoring` v1);
- runner, runtime, and selected/reported model identities;
- generation-policy compatibility identity;
- run status;
- planned, attempted, passed, failed, unavailable, and cancelled counts;
- nullable score numerator, denominator, and value;
- bounded task status, request latency, and time-to-first-content;
- canonical result digest;
- canonical comparison compatibility, reason, compared run ids, and nullable deltas.

The projection excludes task prompts, generated prose, provider payloads, secrets, local paths, and arbitrary diagnostic text. Identifiers are allowlisted and invalid values are replaced with safe bounded placeholders. Null remains null; missing score, latency, or TTFT is never converted to zero.

## Evidence states

`NO_DATA` means there is no usable Bench record. `UNAVAILABLE` means history contains invalid or unusable records without a usable run. `PARTIAL` is the bounded controlled-result state: a run exists, but task, history, or comparable-run coverage may be limited. `NOT_COMPARABLE` is used when canonical comparison blocks equivalence because pack, runner, scorer, or generation identity differs.

The UI labels these states plainly: no controlled result yet, controlled result unavailable, bounded controlled result, or runs are not comparable. A completed bounded run is not mislabeled as no data merely because there is no second run to compare.

## Supported questions

Advisor can answer questions such as:

- “How did this model perform in my latest controlled test?”
- “Which tasks failed?”
- “Can these runs be compared?”
- “What changed between the two canonical runs?”
- “Did the newer run pass more tasks, and what happened to latency?”

For a compatible comparison, Advisor reports only canonical deltas. For an incompatible comparison, it explains the identity mismatch and refuses to compare the numbers.

## Refusal boundary

Advisor must not infer best model, smartest model, best coding model, buying advice, a universal leaderboard, general quality superiority, or a workflow recommendation from this synthetic task pack. It should understand the question, state that the evidence is one bounded controlled pack, and offer a supported next investigation.

The deterministic runtime owns the controlled-result conclusion. A local or hosted model may provide qualitative wording only after the evidence projection is built; it cannot add score, ranking, causal, or recommendation claims. Hosted evidence remains content-minimal and excludes raw Bench task text and model prose.

## Verification

Tests cover no-data and unavailable history, bounded run/task projection, compatible and incompatible comparison handling, nullable metrics, stable identifiers, privacy exclusions, cancellation, and overclaim/refusal behavior. The bridge uses existing Bench history/comparison authorities; there is no second scorer and no conversational mutation path.
