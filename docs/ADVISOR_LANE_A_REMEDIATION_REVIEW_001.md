# Metrora Advisor Lane A — remediation review 001

Status: READY_FOR_FOUNDER_REVIEW
Branch: feat/advisor-local-intelligence-v2

This note records the post-implementation Luna Max review loop for the local-first Advisor, hosted BYOK, and Bench evidence boundary.

## Remediated findings

- Hosted provider consent is carried in the runtime payload and required again by the Electron main-process parser.
- Hosted streamed previews are sanitized before renderer display; provider probe cancellation now reaches the main-process fetch flight.
- Credential clear fails closed when unlink fails, and read-side safe-storage re-encryption is serialized with set/clear operations.
- Changing hosted provider/model cannot reuse the prior runtime consent or credential-entry state; unsupported-only discovery cannot activate a runtime.
- Bench history is filtered to representable Advisor scope dimensions. Project/provider-specific scopes fail closed when Bench lacks that dimension; model and period/range scopes are filtered. Incomplete or cancelled runs cannot become the usable latest result or expose score fields.
- Failed-task questions are classified as Bench questions, generation-policy identities remain comparable for bounded numeric parameters, and hosted answers are labeled as hosted provider output.
- Protected hosted/credential IPC channels reject calls from untrusted renderer frames.

## Verification

- npm --prefix app run typecheck — passed.
- Focused Lane A validation — 11 files, 177 tests passed.
- Full app validation — 747/748 in two parallel Vitest runs; the single failure is the pre-existing bounded CLI watchdog test under full-suite contention. electron/cli.test.ts passes 48/48 when isolated, including the failing case.
- git diff --check — passed.
- No real provider calls, PR, merge, or CI claim was made.
