# Metrora security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:

`https://github.com/maikolsiragusaa/metrora/security/advisories/new`

Do not open a public issue for a suspected vulnerability. Include the affected surface, reproduction steps, impact, and a safe proof of concept where possible. Do not include real prompts, source code, credentials, or private session data unless explicitly requested through a secure channel.

## Current scope

Security reports are welcome for:

- the TypeScript engine and CLI (`src/`);
- provider collectors and local artifact parsing;
- local cache, history, and migration behavior;
- local web dashboard (`dash/`);
- Electron desktop application (`app/`);
- macOS menubar (`mac/`) and GNOME extension (`gnome/`);
- device pairing and local sharing;
- release, installer, update, and CI workflows;
- privacy boundaries and unintended data disclosure.

## Security principles

- Local-first operation and least privilege.
- No prompt or source-code collection by default.
- No secret or full local-path export by default.
- Renderer isolation from direct filesystem and process access.
- Revocable and scoped device pairing.
- Explicit provenance for analytical values.

## Harness-specific boundaries

- Metrora first-party factual Tools use the versioned, content-minimal `metrora-factual-tool-v1` read contract. Their immutable scope and evidence semantics are owned by Metrora; Bench execution, agent launch, routing changes, and policy changes are not factual Tools.
- The Harness runs one DSH Agent/Session path for local and hosted models. Local Ollama/LM Studio/llama.cpp calls use fixed loopback origins from Electron main. Hosted BYOK calls use fixed official provider origins from Electron main after explicit consent; arbitrary endpoints and gateway routing are not accepted.
- Runtime lifecycle events projected to the renderer are safe DTOs containing bounded status, timing and redacted summaries. Raw provider payloads, hidden prompts, tool arguments, and unbounded tool results stay out of renderer event listeners.
- Provider credentials are accepted through a transient password field, sent to main-process custody, cleared from renderer state, and never returned through the status API. Durable storage uses Electron `safeStorage` when available.
- Tool-result JSON is bounded and strictly checked for content-minimal privacy before it is sent to a model. Raw prompts, responses, source, unrestricted paths, secrets, and hidden reasoning are not part of the Harness projection.

## Release integrity

The latest public Windows technical preview is the **unsigned** GitHub pre-release `v1.0.0-rc.7`. Its release assets are bound to the published release evidence and checksums; it is not a signed stable channel, a Microsoft Store package, or an automatic update channel.

Metrora also has an assigned Microsoft Store package identity and a reviewed AppX build/local-acceptance path. RC10 remains the published Store authority; RC11 is the current submitted candidate undergoing Microsoft certification. Submission is not certification or publication, and RC11 is not a Store-availability claim.

Stable signing, Store publication, and any future update-channel claims must remain explicit and channel-specific. Upstream Metrora artifacts are not Metrora releases.

## Upstream reports

A vulnerability that exists unchanged in the reviewed inherited baseline may also require responsible disclosure to the upstream project. Metrora will preserve reporter confidentiality and coordinate when appropriate.
