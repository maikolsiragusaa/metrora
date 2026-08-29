# Metrora Bench evidence families

**Status:** public product/evidence classification  
**Current implementation:** runtime-timing evidence and Core Compatibility are shipped; the broader Performance direction described below is planned and not yet fully implemented.

## Why this distinction exists

`Bench` should not imply that every synthetic run measures the same thing.

Metrora keeps different evaluation questions as separate evidence families so a useful measurement is not silently promoted into a universal model-quality score.

Canonical families:

```text
Bench
├─ Performance                 # primary product direction
├─ Compatibility / Runtime Health
├─ Coding Evaluation           # future
└─ Agent / Harness Evaluation  # future, later
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
- context size;
- batch/thread/offload settings;
- Flash Attention or equivalent runtime configuration;
- concurrency/load profile;
- success/failure/stability state.

A Performance result is conditional on its exact configuration. It does not prove general coding/reasoning quality.

### Current shipped runtime-timing evidence

[BenchRunV1 local Ollama](BENCHRUN_V1_OLLAMA_LOCAL.md) already records a small bounded set of local runtime timing/token evidence from a fixed synthetic Ollama workload.

That contract remains valid and should be understood as an early **runtime-performance evidence slice**, not a quality benchmark.

### Planned broader local Performance

Metrora plans to expand local Performance evidence around the user's actual model/runtime/hardware configuration.

The first planned native engine target is the official llama.cpp **`llama-bench`** tool, behind a Metrora-owned bounded adapter and normalized result contract.

This is a direction, not current llama.cpp support. Current public local runtime support remains documented by the actual Harness/Advisor runtime implementation.

Any future native benchmark integration must pin/identify its tool version, preserve upstream licence/provenance and keep command arguments bounded by Metrora rather than accepting arbitrary shell input.

## Compatibility / Runtime Health

The current [Bench Core conformance v1](BENCH_TASK_PACK_V1.md) belongs to this family.

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

## Agent / Harness Evaluation — future

Agent evaluation measures a complete agent/harness workflow, not only a foundation model.

It becomes relevant only after Metrora has real, separately authorized agent/Swarm execution to evaluate.

No Agent/Harness Evaluation implementation is shipped today.

Any future implementation requires stronger container/sandbox, repository, network, secret, cost and action-authority controls.

## Comparison rules

A numerical comparison is meaningful only when the relevant methodology/configuration is compatible.

Compatibility may depend on fields such as:

- evidence family;
- runner/tool version;
- task pack/version;
- workload/request parameters;
- model identity;
- runtime identity;
- hardware/configuration where material;
- context/batch/offload settings for Performance.

Metrora may display non-equivalent runs side-by-side, but must label them rather than fabricate a fair winner.

## Relationship to Usage

Bench evidence is controlled test evidence.

It is separate from observed real-world Metrora Usage/Activity.

Do not mix benchmark tokens/latency/cost with normal user Session totals merely because both involve model calls.

## Relationship to Harness

Metrora Harness may:

- read Bench evidence;
- explain what a result measures;
- compare compatible runs;
- describe observed speed/memory trade-offs;
- later prepare a bounded run proposal.

Harness may not:

- change canonical Bench values;
- turn Compatibility into Coding quality;
- turn Performance into reasoning quality;
- silently compare incompatible runs;
- start a state-changing run without the accepted action authority for that workflow.

## Privacy

Performance evidence may include more hardware context than ordinary usage analytics.

Share/export contracts should exclude machine names, usernames, serial numbers, local paths and unrelated host identifiers unless a future explicit contract says otherwise.

Model-weight licences remain independent of benchmark-engine licences.

## Current public summary

| Evidence family | Current state |
| --- | --- |
| Runtime timing / small Performance evidence | **Shipped:** BenchRunV1 local Ollama |
| Compatibility / Runtime Health | **Shipped:** Core conformance v1 |
| Broader hardware Performance | **Planned:** first native target llama.cpp/`llama-bench` |
| Coding Evaluation | **Future / not shipped** |
| Agent / Harness Evaluation | **Future / not shipped** |

No current Bench family establishes a universal `best model` ranking.
