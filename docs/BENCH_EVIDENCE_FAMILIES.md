# Metrora Bench evidence families

**Status:** public product/evidence classification  
**Current implementation:** the local runtime-timing slice, Core Compatibility, and the first native llama.cpp/`llama-bench` Performance path are shipped as separate evidence families.

## Why this distinction exists

`Bench` should not imply that every synthetic run measures the same thing.

Metrora keeps different evaluation questions as separate evidence families so a useful measurement is not silently promoted into a universal model-quality score.

Canonical families:

```text
Bench
├─ Performance                 # primary product direction
├─ Compatibility / Runtime Health
├─ Coding Evaluation           # future
└─ Agent Evaluation            # future, later
```

## Performance — primary direction

The mainstream Performance question is:

> **How does this declared model/runtime/configuration run on this hardware?**

Useful Performance evidence can include, where measured reliably:

- prompt processing / prefill throughput;
- generation / decode throughput;
- time to first token/output;
- request/total latency;
- RAM/VRAM use;
- hardware/runtime/backend identity;
- depth/workload shape where the upstream runner reports it;
- batch/thread/offload settings;
- Flash Attention or equivalent runtime configuration;
- concurrency/load profile;
- success/failure/stability state.

A Performance result is conditional on its exact configuration. It does not prove general coding/reasoning quality.

### Current shipped runtime-timing evidence

[BenchRunV1 local Ollama](BENCHRUN_V1_OLLAMA_LOCAL.md) already records a small bounded set of local runtime timing/token evidence from a fixed synthetic Ollama workload.

That contract remains valid and should be understood as an early **runtime-performance evidence slice**, not a quality benchmark.

### Shipped native local Performance

The first native engine is now available through the official llama.cpp **`llama-bench`** tool, behind a Metrora-owned bounded adapter and normalized result contract. It connects to an executable and .gguf model selected by the user; it does not download, build or start llama.cpp.

The adapter records the declared methodology and the controlled upstream
observed configuration (`n_batch`, `n_ubatch`, `n_threads`, `n_gpu_layers`,
`split_mode`, `main_gpu`, `flash_attn`, `n_prompt`, `n_gen`, repetitions and
`n_depth`) alongside model identity, runtime/build fields, hardware fields and
throughput/timing fields when present. `test_time` is retained as an ISO
timestamp; missing fields remain unknown. It accepts only known bounded
arguments, always emits the declared split mode (including `none`), spawns
directly without a shell, bounds output/lifetime/cancellation, fails closed on
material declared/observed mismatch, and stores Performance history separately
from Core Compatibility history.

The factual aggregation is owned by the transport-neutral `src/bench` source.
Desktop Bench and read-only MCP project the same retained records, comparisons
and state; neither adapter recomputes truth and MCP has no Bench execution
path.

This is local existing-binary support, not a bundled llama.cpp distribution. The executable's reported build identity remains part of the evidence where available, and the exact llama.cpp provenance/licence boundary is documented in [Local runtime and Performance Wave 001](LOCAL_RUNTIME_PERFORMANCE_WAVE_001.md).

## Compatibility / Runtime Health

The current [Bench Core Compatibility / Runtime Health v1](BENCH_TASK_PACK_V1.md) belongs to this family.

It answers narrow questions such as:

- can the selected runtime/model complete this exact fixed task pack?;
- does exact/structured response behavior work?;
- did this same declared compatibility workflow regress?;
- can Metrora retain/compare this exact controlled result safely?

The current Core pack is useful, especially as a deterministic workflow/runtime check, but it is **not** evidence of universal model quality.

Preferred user language is therefore `Compatibility`, `Runtime Health`, or `Core compatibility` rather than treating its pass rate as a general benchmark ranking.

## Coding Evaluation — future

A future Coding Evaluation family would ask a different question:

> How capable is a model on a declared, versioned coding task set under a reproducible methodology?

Metrora should prefer established open evaluation methodology/runners rather than inventing a universal proprietary score from a tiny task set.

No Coding Evaluation implementation is shipped today.

Any future implementation needs separate review for:

- task/dataset licence;
- sandboxing generated code;
- fixed/versioned methodology;
- contamination/reproducibility disclosure;
- artifact retention;
- scoring semantics;
- clear separation from Performance.

## Agent Evaluation — future

Agent evaluation measures a complete agent workflow, not only a foundation model.

Metrora now has real Agent/Subagent execution through the accepted upstream OpenCode Code surface. That makes future Agent Evaluation technically relevant, but it does **not** define a benchmark methodology or make ordinary product sessions comparable evaluation evidence.

No Agent Evaluation implementation is shipped today.

Any future implementation requires a separately versioned methodology and stronger review for:

- task/dataset and repository rights;
- disposable container/sandbox isolation;
- repository, network and secret boundaries;
- runtime/Agent configuration identity;
- cost/resource limits;
- reproducibility and contamination disclosure;
- artifact/result retention;
- scoring/comparability semantics;
- clear separation from ordinary Code usage and Activity history.

## Comparison rules

A numerical comparison is meaningful only when the relevant methodology/configuration is compatible.

Compatibility may depend on fields such as:

- evidence family;
- runner/tool version;
- task pack/version;
- workload/request parameters;
- model identity (different models may be compared when the methodology and
  runtime evidence are otherwise compatible);
- runtime identity;
- hardware/configuration where material;
- declared and observed batch/offload/split settings for Performance;
- environment identity and the usable upstream configuration evidence.

Metrora may display non-equivalent runs side-by-side, but must label them rather than fabricate a fair winner.

## Relationship to Usage

Bench evidence is controlled test evidence.

It is separate from observed real-world Metrora Usage/Activity.

Do not mix benchmark tokens/latency/cost with normal user Session totals merely because both involve model calls.

## Relationship to consumers

Desktop Bench and read-only MCP may read the canonical evidence, explain what a
result measures, compare compatible runs and describe observed trade-offs. No
consumer may change canonical Bench values, turn Compatibility into Coding
quality, turn Performance into reasoning quality, silently compare incompatible
runs or start state-changing work without the accepted action authority for that
workflow.

## Privacy

Performance evidence may include more hardware context than ordinary usage analytics.

Share/export contracts should exclude machine names, usernames, serial numbers, local paths and unrelated host identifiers unless a future explicit contract says otherwise.

Model-weight licences remain independent of benchmark-engine licences.

## Current public summary

| Evidence family | Current state |
| --- | --- |
| Runtime timing / small Performance evidence | **Shipped:** BenchRunV1 local Ollama |
| Compatibility / Runtime Health | **Shipped:** Core Compatibility v1 |
| Broader hardware Performance | **Shipped:** native llama.cpp/`llama-bench` adapter |
| Coding Evaluation | **Future / not shipped** |
| Agent Evaluation | **Future / not shipped** |

No current Bench family establishes a universal `best model` ranking.