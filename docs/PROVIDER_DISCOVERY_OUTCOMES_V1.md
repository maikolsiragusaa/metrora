# Provider discovery outcomes v1

Metrora provider discovery now carries an internal, versioned outcome alongside
its existing source list. The contract is `metrora.provider-discovery-outcome.v1`
and distinguishes six states:

- `success` — discovery completed and returned one or more valid source locators;
- `empty` — discovery completed and factually returned no sources;
- `unavailable` — a known environmental condition, such as a missing or
  permission-locked source, prevents observation;
- `failed` — discovery was attempted but did not complete successfully;
- `partial` — some valid source evidence was recovered, but completeness is not
  established;
- `cancelled` — the caller cancelled before truthful completion.

Only `success` and `empty` are complete outcomes. A successful empty result is
not the same as a thrown discovery error.

## Cache and publication boundary

The parser uses the outcome to gate source reconciliation. A complete outcome
may authorize removal of a non-durable cached source that is no longer present
in the current source set. `failed`, `partial`, `unavailable` and `cancelled`
outcomes never authorize that deletion.

When discovery is not complete, cached source entries remain available as
retained-only history, the session cache is not published as complete, and the
daily-history completeness authority stays degraded. This prevents a temporary
permission problem, malformed source family or cancellation from becoming a
false statement that a provider has zero history. Durable-source carry-forward
remains governed by its existing monotonic rules.

## Diagnostics and ordering

The public source-list API remains compatible for existing callers. The parser
and freshness checks use the outcome-aware registry API. Provider discovery is
isolated and executed in deterministic name order; it is intentionally
sequential in this contract. Diagnostics use fixed bounded messages and do not
include local paths, secrets or raw provider exception text. Doctor remains the
existing source-root diagnostic surface; this contract does not redesign it.

Existing providers that return a normal source array require no boilerplate.
Normal non-empty arrays map to `success`, normal empty arrays map to `empty`,
known unavailable filesystem conditions map to `unavailable`, and thrown errors
map to `failed`. Providers that can recover a subset may use the partial outcome
extension without changing the source parser contract.
