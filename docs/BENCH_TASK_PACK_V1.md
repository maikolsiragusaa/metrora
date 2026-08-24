# Bench task pack v1

The Bench task pack is a bounded, local-first evidence surface for checking a
selected Ollama runtime against a small versioned set of synthetic tasks. It is
separate from [BenchRunV1](BENCHRUN_V1_OLLAMA_LOCAL.md), which remains the
timing-and-runtime evidence contract used by `bench local`.

It is not a general model-quality benchmark. It does not rank or recommend
models, calculate cost or quota, read Metrora Usage records, inspect user work,
send data to a service, or claim that a model is better outside this exact
task-pack result.

## Run it

```bash
metrora bench task-pack --model <ollama-model>
metrora bench history --format table
metrora bench compare <left-run-id> <right-run-id> --format table
```

The model is required and must be selected explicitly. The runtime boundary is
fixed to `http://127.0.0.1:11434`; there is no option for a remote or arbitrary
OpenAI-compatible endpoint. Ollama must already be running locally. Each task
uses one bounded request with the fixed generation parameters
`temperature: 0`, `seed: 1729` and `num_predict: 64`.

`--format json` emits the versioned evaluation contract. `--no-save` keeps the
result out of local history. The bounded `--timeout-ms` range is 50–120000 ms.

## Fixed pack and scoring

The public pack is `metrora.bench.core@1.0.0`, identified by its SHA-256 pack
digest. It contains six synthetic assertions covering exact text, normalized
text, exact arithmetic, exact JSON and JSON-shape validation. The task prompts
and raw generated text are transient runner inputs; persisted history contains
only task ids, pass/fail state, bounded output metadata and digests.

The deterministic score is the number of passed assertions divided by the
number of attempted assertions that produced a score. Unavailable, timeout and
cancelled work remains explicitly represented and does not become a fabricated
zero. Runtime-reported timing and token fields remain nullable when Ollama does
not provide them.

## Local history and comparison

Saved results use schema `metrora.bench-history.v1` under the private Metrora
data directory at `bench-history/v1/records`. Writes are atomic and protected
by the local-state lease. History is bounded to the newest 50 records and 5 MiB;
corrupt or invalid files are reported as invalid rather than trusted. There is
no upload or managed storage path.

Comparison is factual and compatibility-gated. Results must use the same pack
identity, runner, task set and generation parameters. Compatible comparisons
show pass-rate, count and observed timing/metric deltas; incompatible results
show a reason and no numerical delta. The surface deliberately has no
leaderboard, ranking, cost estimate or cross-pack comparison.

The Desktop route is **Analyze → Bench**. It uses the same local CLI boundary,
requires an explicit model name, shows recent private history and exposes only
the same compatibility-gated factual comparison.

## Contract and provenance

The evaluation contract is `metrora.bench-evaluation.v1` and the runner is
`ollama-task-pack-v1@1.0.0`. The result digest covers the pack, selected and
reported model, runtime version and bounded per-task evidence metadata. It is an
evidence identity, not a reproducibility or quality guarantee.

The implementation uses Node's bounded HTTP `fetch` and follows the official
Ollama [`/api/generate`](https://docs.ollama.com/api/generate),
[`/api/version`](https://docs.ollama.com/api-reference/get-version) and
[`streaming`](https://docs.ollama.com/api/streaming) documentation. Individual
model weights remain subject to their own licenses and operator review.
