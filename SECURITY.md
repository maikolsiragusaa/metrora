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

Metrora does not yet publish official binaries. Signing, checksums, update channels, and store identities will be documented before an official release. Upstream CodeBurn artifacts are not Metrora releases.

## Upstream reports

A vulnerability that exists unchanged in the CodeBurn-derived baseline may also require responsible disclosure to the upstream project. Metrora will preserve reporter confidentiality and coordinate when appropriate.