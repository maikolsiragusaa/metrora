# Metrora technical identity and state boundaries

Metrora is the only canonical product identity. New code, UI, documentation,
release metadata and generated artifacts use Metrora names exclusively.

## Canonical names

- Product and desktop application: `Metrora`
- Website: `metrora.eu`
- Repository: `maikolsiragusaa/metrora`
- CLI command: `metrora`
- Desktop bridge: `window.metrora`
- IPC prefix: `metrora:`
- Environment variables: `METRORA_*`
- Renderer storage prefix: `metrora.`
- Desktop CLI pointer directory: `Metrora`
- Default local data directory: `Metrora` / `metrora`

## Current product boundary

The current product emits canonical identifiers only:

- `app/electron/identity.ts` and `app/electron/cli.ts` resolve Metrora
  executables, environment variables and persisted pointers;
- `src/product-paths.ts` creates and resolves Metrora config and cache roots;
- `app/renderer/lib/storage.ts` uses the `metrora.` renderer namespace;
- the package `bin` map publishes only the `metrora` command.

New files, writes, IPC messages, preload globals, diagnostics and release
artifacts use Metrora names only. Retired product roots, aliases and renderer
keys are not adopted or deleted automatically.

## Local data outcome

- `METRORA_DATA_DIR` wins when defined.
- Fresh config and cache paths use the canonical Metrora roots.
- Existing canonical files are never overwritten.
- Canonical Metrora analytics and history remain in place, including schema
  migrations within the canonical roots.
- Retired pre-release config, cache and CLI pointer roots are no longer
  inferred by a fresh installation and are not removed by the application.
- No migration performs telemetry or uploads data.

## Historical Workspace and evidence boundary

`src/local-state/legacy-identity-compatibility.ts` and its consumers retain a
separate read/verification boundary for pre-release Workspace and signed
evidence records. This code is not a current product alias: it must not emit
retired identity, rewrite signed or hashed records, or change the canonical
analytics path.

Candidate #694 Workspace/evidence artifacts are historical development state
and are not transformed by this cleanup. Retiring that state or introducing a
new clean-start/migration procedure requires a separately reviewed change.

## Removal criteria

The historical evidence boundary can be removed only through a separately
reviewed migration that preserves verification semantics and does not destroy
user-owned analytics or evidence. The current cleanup intentionally does not
perform that migration.
