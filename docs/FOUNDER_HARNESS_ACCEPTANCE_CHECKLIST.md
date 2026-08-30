# Founder Harness acceptance checklist

Use this checklist against the packaged Desktop build from the Harness Productization V2 review branch. The goal is to verify the product boundary, not just that a request returns text.

## Start and identity

- [ ] Start from a clean session with no local model available. Harness opens without a classifier error, fake readiness claim, or forced Metrora-only question.
- [ ] The primary conversational surface is labelled **Metrora Harness** / **Ask Harness**. Ordinary UI does not present Advisor as a second product.
- [ ] Runtime and model controls are compact, truthful and session-local. An unavailable runtime is visibly unavailable.
- [ ] A configured capable runtime can answer a normal greeting or general question without an evidence bundle.

## Factual Tools

- [ ] Ask a spend, model-efficiency, quota, overview, Project-driver, session-highlight, coverage or Bench-evidence question.
- [ ] Verify that factual values come from canonical evidence and preserve scope, freshness, coverage, unknown and unavailable semantics.
- [ ] Verify that the Tool activity block shows only compact bounded status such as queued, reading, completed, unavailable or failed.
- [ ] Verify that the public Tool contract keeps exactly these identities: `get_spend_snapshot`, `get_model_efficiency`, `get_quota_snapshot`, `get_overview_snapshot`, `get_project_drivers`, `get_session_highlights`, `get_coverage_report`, `get_bench_evidence`.
- [ ] Change period, provider, Project or model and confirm the submitted turn uses the selected immutable scope.
- [ ] Confirm that UI context and evidence references help explain referents but cannot replace canonical evidence.

## Bounds and privacy

- [ ] Exercise a question that needs more than one read and confirm the turn remains bounded at two rounds and four Tool calls.
- [ ] Cancel during a pending runtime/tool turn and confirm no late result is published as current.
- [ ] Try an unknown Tool, malformed/additional arguments, an unsupported provider, and a scope-widening request. Each fails closed with a useful bounded explanation.
- [ ] Confirm activity, errors and streamed conversational deltas contain no chain-of-thought, raw prompt, provider response, secret, credential, arbitrary local path or raw evidence payload.
- [ ] Confirm session history remains local to the session and hosted evidence sharing remains explicit.

## Core Compatibility proposal boundary

- [ ] Ask to run the Core Compatibility pack with an explicit local Ollama model. Harness shows a proposal with model, pack, checks and bounded effects; it does not execute on proposal creation.
- [ ] Confirm the proposal card offers explicit confirmation and cancellation and displays a safe digest/status projection only.
- [ ] Inspect the renderer-visible IPC result/event and confirm it contains no `ActionContractV1`, approval token, provider credential, task prompt, generated output or arbitrary path.
- [ ] Confirming sends only the action ID and proposal digest to the trusted host. The host re-reads and canonicalizes the sole `ActionContractV1`, then ACT owns approval, execution, cancellation, timeout, replay and freshness behavior.
- [ ] Confirm ACT lifecycle progress is truthful and that final result/evidence status comes from canonical Bench history.
- [ ] Change/tamper the proposal digest, retry a completed action, restart with stale state, or cancel before confirmation. Verify each path fails closed or remains cancelled without duplicate execution.
- [ ] Ask to run another operation such as an arbitrary Bench/Performance run, agent launch, routing change, policy change or shell/repository action. Verify Harness remains proposal-only and does not expose an executor.

## Local llama.cpp runtime and Performance Bench

- [ ] In Desktop runtime controls, select `llama.cpp server` and confirm discovery is limited to an existing loopback server at the fixed local default (`127.0.0.1:8080`); no download, build, start, credentials or remote endpoint flow appears.
- [ ] With a reachable llama-server, confirm `/health` and `/v1/models` produce bounded model discovery and that normal chat supports streaming and cancellation through the existing Harness conversation loop.
- [ ] Verify malformed, loading, unreachable and non-loopback server states remain explicit and do not fall back to a fabricated model or capability.
- [ ] In Bench → Performance, select an existing `llama-bench` executable and `.gguf` model with the native pickers. Confirm the setup shows bounded repetitions/prompt/decode/batch/ubatch/GPU/Flash-Attention settings and no arbitrary command-line field.
- [ ] Run and cancel a Performance measurement. Confirm progress, cancellation, timeout, malformed output, non-zero exit and unavailable executable states remain truthful and no late result replaces the current state.
- [ ] Confirm the retained Performance record is separate from Core Compatibility history, keeps upstream throughput/timing and declared setup/build/hardware fields when available, leaves absent fields unknown and exposes no universal score.
- [ ] Compare two retained Performance records. Confirm deltas appear only for compatible methodology/runner/setup/hardware/completed records; incompatible or incomplete records show a reason without invented numbers.
- [ ] Ask Harness to explain the retained Performance evidence and confirm it reads through `get_bench_evidence` without launching a benchmark or adding a new ACT kind.

## Out of scope confirmation

- [ ] No new external MCP write path, Swarm, Android, managed inference, arbitrary endpoint, repository/shell executor or broad README/artwork redesign is presented as shipped.
- [ ] llama.cpp support remains existing-binary-only and loopback-only for the server adapter; native Performance remains an explicit local Bench operation.
- [ ] The canonical checkout remains untouched; this review uses one new isolated worktree and no subagents.

## Automated release gates

- [ ] Focused root Vitest and focused app Vitest pass.
- [ ] Root and app TypeScript checks pass.
- [ ] CLI, Desktop and packaged staging/build checks pass.
- [ ] `git diff --check` passes and the final review confirms no unrelated files or generated artifacts were changed.
