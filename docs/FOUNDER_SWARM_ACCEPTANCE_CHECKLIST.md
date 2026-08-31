# Founder Harness Swarm V2 acceptance checklist

This checklist exercises the public manual, bounded Swarm strategy stacked on
the local-runtime and Performance foundation. It is not a claim about private
adaptive orchestration or Smart Auto.

## Before starting

- Build from branch `feat/harness-orchestration-v2` at the reviewed authority
  base `b08e139ff460ab442b13d166b1798e5daa664a29`.
- Run the desktop development or production build. The public manual strategy
  is enabled by default unless the deployment explicitly disables it.
- Have Ollama or llama-server available where possible and select a discovered
  model in Harness runtime controls.

## A. Basic local Swarm

- Open Metrora Harness and confirm the default mode is Chat.
- Confirm the mode switch labels the strategy `Swarm`.
- Confirm Chat and Swarm use the same conversation history and shared Harness
  composer; worker count is a bounded Swarm setting, not a second task input.
- Submit a simple factual Metrora question with the default two workers.
- Confirm the Investigator and Verifier rows become queued, running, and
  complete.
- Confirm the selected runtime and model labels are visible.
- Confirm the final synthesis is conversational and bounded.
- Confirm a completed Swarm result is added to the same thread as a normal
  Harness assistant result.

## B. Tool-backed Swarm

- Submit a question that needs spend, model, Project, quota, or Bench facts.
- Confirm only canonical read-only Metrora Tool names appear in worker activity.
- Confirm no shell, file, repository, credential, raw prompt, raw response, or
  hidden reasoning text is rendered.
- Confirm the final answer distinguishes measured evidence from unavailable
  evidence.

## C. Mixed worker outcome

- Force or simulate one worker failure/unavailable result.
- Confirm the other worker can complete.
- Confirm Swarm is marked partial and the final synthesis states which evidence
  was unavailable or failed.
- Confirm one worker failure does not erase the successful worker result.

## D. Cancellation

- Start an active Swarm and press Cancel.
- Confirm every worker reaches a terminal cancelled state.
- Confirm the final run is cancelled and no late worker result changes the UI.
- Confirm no worker remains active after the run is cancelled.
- Confirm a synthesis timeout produces a terminal fallback and retains worker
  results.

## E. Runtime and model identity

- Confirm the exact safe runtime and model labels match the selected Harness
  runtime/model.
- Confirm local model paths, raw llama-server paths, provider keys, and
  subprocess environment values never appear in renderer-visible activity.

## F. ACT boundary

- Ask a worker to perform an action or run a benchmark.
- Confirm the worker can only recommend/propose and cannot execute it.
- For a supported Core Compatibility proposal, confirm the existing trusted
  Host -> explicit confirmation -> ACT path remains the only execution path.
- Confirm the renderer never receives ActionContract authority or an approval
  token from a model.

## G. Privacy

- Inspect visible activity and the bounded evidence record.
- Confirm evidence contains schema/version, run id, task/scope digests,
  identities, statuses, allowed/used Tool names, timestamps, bounded usage when
  factual, and result digests only.
- Confirm raw credentials, arbitrary local paths, raw provider payloads, and
  chain-of-thought are absent.

## H. Bounds

- Confirm the default is two workers and the UI maximum is three.
- Confirm more than three workers is rejected by the coordinator.
- Confirm each worker is limited to four Tool calls and one planning/Tool round,
  bounded output, an individual timeout, and the bounded whole-run timeout.
- Confirm the native V1 worker does not add a second planning or replanning loop;
  future multi-round workers require a separately defined lifecycle contract.
- Confirm there is no recursive spawning and no unbounded retry loop.

## Regression

- Harness Chat still works without selecting Swarm.
- Ollama and llama-server runtime selection/probing remains bounded; a custom
  loopback port is accepted and non-loopback endpoints are rejected.
- Performance Bench still loads and retains its existing evidence semantics.
- MCP still exposes factual/read-only access only.
- Core Compatibility still requires the existing explicit ACT confirmation.
- The public repository contains no OpenHands or ACP runtime dependency.
