# BenchRunV1 local Ollama

BenchRunV1 is Metrora’s first small, public Bench slice. It records bounded
local runtime evidence for one explicitly selected Ollama model using a fixed,
versioned synthetic workload.

It is not a model-quality benchmark. It does not score accuracy, coding,
reasoning, pass rate or “best” model; it does not rank or recommend models; it
does not calculate cost or quota; and it does not read Metrora Usage records or
real user work.

## Run it

```bash
metrora bench local --model <ollama-model>
metrora bench local --model <ollama-model> --format json --output ./benchrun.json
```

The model is required and must be selected explicitly. The runtime boundary is
fixed to `http://127.0.0.1:11434`; there is no V1 option for a remote or
arbitrary OpenAI-compatible endpoint. Ollama must already be running locally.
The default per-request timeout is 30 seconds. `--timeout-ms` may narrow or
extend it only within the bounded 50–120000 ms range.

On an unavailable runtime, timeout, cancellation or malformed response, the
CLI prints a bounded diagnostic and exits non-zero. `--format json` still
emits the JSON-safe run contract when a run has partial or failed evidence.

## Fixed methodology

- one warmup request followed by five measured requests;
- the same `metrora.benchrun.synthetic.v1@1.0.0` fixture and request
  parameters for every request;
- generation parameters: `temperature: 0`, `seed: 1729`, `num_predict: 64`;
- streaming `/api/generate` requests, with bounded response bytes, chunks,
  events, NDJSON lines and generated output;
- no dataset loading, filesystem prompt discovery, source-repository access or
  user-content input.

Ollama/model support can still vary. A fixed seed and temperature do not prove
cross-model or cross-version deterministic text generation; that limitation is
retained as an evidence boundary rather than converted into a quality claim.

## BenchRunV1 contract

The artifact uses schema `metrora.bench-run.v1` and runner
`ollama-local-v1@1.0.0`. It contains:

- run, runner, fixture, selected/reported model and local runtime identity;
- factual environment identity limited to OS, architecture and Node version;
- fixed generation parameters and the `1 + 5` methodology;
- start/end timestamps and per-run success, failure or cancellation state;
- Metrora-observed request latency, time to first streamed content, bounded
  response/chunk/event counts, output character length and output digest;
- nullable Ollama-reported duration and token fields;
- measured-run aggregates using count, min, median, max and mean;
- failures, unstarted-run exclusions, termination status and a result digest.

Observed timing and runtime-reported timing/token data remain separate. Ollama
duration and token fields remain `null` when the runtime does not report them;
they are never replaced with zero or an estimate. Raw generated text is not
written to the artifact.

The result digest covers the versioned fixture, fixed generation contract,
selected/reported model and per-run output/result metadata. It excludes run
timestamps and timing values, so timing variation alone does not change the
result identity. It is an evidence digest, not a reproducibility or quality
guarantee.

## Runtime and provenance

The implementation uses Node’s bounded HTTP `fetch` and no Ollama SDK or model
provider dependency. The response shape follows the official Ollama
[`/api/generate`](https://docs.ollama.com/api/generate),
[`/api/version`](https://docs.ollama.com/api-reference/get-version) and
[`streaming`](https://docs.ollama.com/api/streaming) documentation. Ollama’s
reported duration values are nanoseconds, and the stream is newline-delimited
JSON. No Ollama source code is copied into Metrora, so no third-party notice is
added by this slice. Individual model weights remain subject to their own
licenses and operator review.

An output artifact is written only when the user supplies `--output`; the
write is local, bounded and atomic. There is no upload, publication, managed
compute path, cloud credential, persistent Bench database or Desktop Bench
navigation in V1.
