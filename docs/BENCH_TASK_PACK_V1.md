# Bench Core Compatibility / Runtime Health v1

**Evidence family:** Compatibility / Runtime Health  
**Current status:** shipped public local contract  

See [Bench evidence families](BENCH_EVIDENCE_FAMILIES.md) for the distinction between Performance, Compatibility, future Coding Evaluation and future Agent/Harness Evaluation.

The existing `metrora.bench.core@1.0.0` task pack is a bounded local-first **Compatibility / Runtime Health** surface for checking a selected Ollama runtime/model against a small fixed versioned set of synthetic tasks.

It is separate from [BenchRunV1](BENCHRUN_V1_OLLAMA_LOCAL.md), which records timing/runtime evidence.

It is **not** a general model-quality benchmark. It does not rank/recommend models, calculate cost/quota, read Metrora Usage, inspect user work, send data to a service, or establish coding/reasoning superiority outside this exact pack.

## What this pack is useful for

The pack can answer narrow questions such as:

- did this selected runtime/model complete the exact fixed checks?;
- does exact/structured response behavior work for this declared workflow?;
- did a compatible run regress relative to another compatible run?;
- can Metrora retain/compare this controlled result safely?

A `6 / 6` result means **all six Core Compatibility checks passed**. It is not a universal 100% model-quality score.

## Run it

```bash
metrora bench models --format table
metrora bench task-pack --model <ollama-model>
metrora bench history --format table
metrora bench compare <left-run-id> <right-run-id> --format table
```

`bench models` discovers bounded executable local Ollama model names through `/api/tags` and reports `models-discovered`, `no-models` or `unavailable` without treating runtime failure as an empty model list.

The Desktop picker uses this discovery when available and keeps manual model entry as an explicit fallback. A manually entered name is not proof the model is installed.

The runtime boundary is fixed to `http://127.0.0.1:11434`; there is no remote/arbitrary OpenAI-compatible endpoint option. Each task uses one bounded request with fixed `temperature: 0`, `seed: 1729`, `num_predict: 64`.

`--format json` emits the versioned evaluation contract. `--no-save` keeps the result out of local history. `--timeout-ms` is bounded to 50–120000 ms.

## Fixed pack and scoring

Public pack: `metrora.bench.core@1.0.0`, identified by its SHA-256 pack digest.

It contains six synthetic assertions covering:

- exact text;
- normalized text;
- exact arithmetic;
- exact JSON;
- JSON-shape validation.

Task prompts/raw generated text are transient runner inputs. Persisted history contains only task IDs, pass/fail state, bounded output metadata and digests.

The deterministic pass rate is passed assertions divided by attempted assertions that produced a score. The UI reports passed/planned checks and pass rate over scored checks.

Unavailable, timeout and cancelled work remain explicit and do not become fabricated zero. Runtime timing/token fields stay nullable when absent.

## Local history and comparison

Saved results use `metrora.bench-history.v1` under the private Metrora data directory at `bench-history/v1/records`.

Writes are atomic and local-state-lease protected. History is bounded to the newest 50 records / 5 MiB. Corrupt/invalid files are reported invalid rather than trusted. There is no upload/managed-storage path.

Comparison is factual and compatibility-gated. Results must use the same pack identity, runner, task set and generation parameters.

Compatible comparisons may show pass-rate/count/observed timing deltas. Incompatible results show the incompatibility and no fabricated numeric delta.

There is no leaderboard, ranking, cost estimate or cross-pack universal comparison.

## Desktop presentation

The current Desktop route remains **Analyze → Bench** until a separately implemented UX migration changes it.

The primary Compatibility result should be understood as something like:

```text
Core Compatibility
6 / 6 checks passed
```

Technical pack identity, digests, task evidence and retained metadata belong under Details/Evidence rather than being mistaken for the headline product value.

Broader hardware Performance is a separate native Bench path documented in [Local runtime and Performance Wave 001](LOCAL_RUNTIME_PERFORMANCE_WAVE_001.md); this Core Compatibility contract does not add or reinterpret it.

## Contract and provenance

Evaluation contract: `metrora.bench-evaluation.v1`  
Runner: `ollama-task-pack-v1@1.0.0`

The result digest covers pack, selected/reported model, runtime version and bounded per-task evidence metadata. It is an evidence identity, not a reproducibility or quality guarantee.

Implementation uses Node's bounded HTTP `fetch` and follows official Ollama `/api/generate`, `/api/version` and streaming semantics. Individual model weights remain subject to their own licences/operator review.

## Harness relationship

The current public implementation exposes Bench evidence through the existing read-only `AdvisorToolV1` tool contract. Product-facing direction is Metrora Harness; current `Advisor*` names remain compatibility identifiers.

Harness may explain what the Compatibility result proves and compare compatible runs. It may not turn Core Compatibility into coding quality or universal model ranking.

Starting a Compatibility run remains separate from the current read-only Harness tool boundary and requires explicit action authority when routed through ACT.
