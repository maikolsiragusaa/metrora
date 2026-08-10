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

## Release integrity

The latest public Windows technical preview is the **unsigned** GitHub pre-release `v1.0.0-rc.7`. Its release assets are bound to the published release evidence and checksums; it is not a signed stable channel, a Microsoft Store package, or an automatic update channel.

Metrora also has an assigned Microsoft Store package identity and a reviewed non-publishing AppX build/local-acceptance path. That work is **pre-submission**: no Microsoft Store certification or publication is claimed by this repository until Microsoft has actually accepted and published the corresponding submission.

Stable signing, Store publication, and any future update-channel claims must remain explicit and channel-specific. Upstream Metrora artifacts are not Metrora releases.

## Upstream reports

A vulnerability that exists unchanged in the reviewed inherited baseline may also require responsible disclosure to the upstream project. Metrora will preserve reporter confidentiality and coordinate when appropriate.
