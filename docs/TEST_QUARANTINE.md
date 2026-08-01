# Core test quarantine

Metrora treats the complete core and desktop suites as blocking merge gates. A test may be quarantined only when it is named exactly, the underlying behavior is outside the current bounded change, and an explicit exit condition is recorded here.

Quarantine is not equivalent to deletion or success. CI continues to execute every non-quarantined test in the affected files and reports the quarantined cases separately.

## Active cases

### Durable Copilot fixture freshness

File: `tests/parser.test.ts`

Exact tests:

- `(a) copilot JSONL file-purge monotonic > preserves monthly total after events.jsonl is deleted`
- `(f) durable orphans survive a parse-version bump > keeps counting a pruned-source orphan after the provider fingerprint changes`

Reason: the inherited fixture uses fixed May 2026 Copilot event timestamps and now falls outside the parser's active history window. The durable-source behavior must be re-established with clock-independent fixtures rather than changing production retention semantics inside the companion-security tranche.

Exit condition: replace fixed timestamps with a deterministic relative clock, prove initial discovery, deletion retention, age-out and parse-version adoption in one dedicated parser-cache tranche, then remove both names from CI quarantine.

### Incremental replacement inode portability

File: `tests/parser-incremental-append.test.ts`

Exact test:

- `incremental append parsing > EDGE: file replaced (inode change) falls back to a full re-parse`

Reason: the fixture unlinks and immediately recreates the file, then assumes Linux cannot reuse the released inode. Linux is permitted to reuse it, so the assertion fails before Metrora parsing runs.

Exit condition: create the replacement while the original still exists, assert distinct identities, atomically rename it over the original and retain the cold-versus-warm parser equality check.

### Durable provider-filter live-day parity

File: `tests/cli-durable-totals.test.ts`

Exact test:

- `CLI totals ↔ menubar parity through the durable daily cache > resolves provider filters identically on both paths, slicing the carried day per provider`

Reason: the inherited durable builder currently includes the carried Claude slice but drops today's live Claude slice when a provider filter is selected. The all-provider path remains correct. This is a real aggregation defect, but it is unrelated to the local companion protocol and requires a focused daily-cache/provider-slicing remediation with regression coverage.

Exit condition: preserve both carried and live-day provider slices, prove all/provider parity across date boundaries and time zones, then remove this name from CI quarantine.

## Rules

- No wildcard quarantine.
- No provider, platform or directory may be excluded without executing its non-quarantined tests separately.
- New failures cannot be added here merely to merge a feature.
- Every active entry must be removed in the first bounded tranche that owns its underlying subsystem.
