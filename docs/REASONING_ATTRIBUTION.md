# Reasoning attribution

Metrora records a reasoning level only when a local source exposes it explicitly or when a saved model label encodes it unambiguously.

## Canonical levels

- `none`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`
- `adaptive`
- `unknown` when no trustworthy attribution exists

`none` and `minimal` are distinct. Zero reasoning tokens do not mean `none`, and non-zero reasoning tokens do not reveal a configured level.

## Evidence

Two evidence classes are currently supported:

- `explicit`: a persisted field such as Codex `reasoning_effort` or a nested equivalent;
- `model-label`: a strict label such as `GPT-5.3 Codex (high reasoning)` or a known reasoning-capable model suffix.

Explicit evidence always wins. Model labels used for pricing and model grouping are not rewritten by reasoning attribution.

## Session mix

A session mix is weighted by API-call count because reasoning effort is selected per call or turn. Each mix row also reports generated tokens, dedicated reasoning tokens and cost as supporting context. Those quantities never determine the attributed level.

Coverage is the share of calls with a known level. Calls without evidence remain in an `unknown` row, including sessions that contain many reasoning tokens but no saved effort setting.

## Provider boundaries

Codex effort changes recorded during a session are applied from the relevant `turn_context` onward, so a session can contain a real mixture of levels.

Zed currently persists a thread-level `thinking_effort` snapshot rather than a trustworthy historical setting for each request. Metrora does not assign that final snapshot to previous calls. It may be shown separately as snapshot-only metadata in a future change.

## Privacy

Reasoning attribution adds structured metadata only. It does not add prompts, assistant text, source code, patches or tool arguments to reports.
