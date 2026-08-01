# Metrora technical identity compatibility

Metrora is the canonical product identity. `Qovrion` is retained only where it is needed to adopt local state created during the previous development name; `CodeBurn` remains only at inherited integration boundaries that have not yet been safely replaced.

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

## Temporary aliases

Metrora accepts these identities in order:

1. the canonical Metrora form;
2. the former Qovrion form;
3. the inherited CodeBurn form.

That precedence applies to the CLI (`metrora`, `qovrion`, `codeburn`), environment variables, persisted CLI pointers, IPC channels and preload globals. An explicitly empty canonical environment value remains authoritative.

## Local-state adoption

- `METRORA_DATA_DIR` wins when defined.
- `QOVRION_DATA_DIR` is accepted as a deprecated fallback when the canonical variable is absent.
- When default locations are used and the Metrora directory does not exist, an existing Qovrion directory is copied to Metrora once.
- Desktop endpoint state is copied from the old Qovrion user-data location without moving, rewriting or deleting the source.
- A readable legacy state that cannot be copied is surfaced as an error; Metrora must not silently create a replacement identity.
- Existing canonical files are never overwritten.
- No migration performs telemetry or uploads data.

## Immutable v1 identifiers

Already-defined v1 evidence and local-state records keep their `qovrion.*`, `dev.qovrion.*`, `urn:qovrion:*` and `schemas.qovrion.dev` identifiers. Those strings are protocol provenance, not visible branding. Rewriting them would invalidate signatures, hashes or stored records. New visible product surfaces use Metrora; a future namespace version can introduce `metrora.*` identifiers through an explicit versioned migration.

## Removal criteria

A temporary alias can be removed only after a stable Metrora release has shipped with adoption support, rollback no longer depends on it, release notes have announced the removal, and tests prove that supported local state no longer requires the alias. Alias removal must be a separate reviewed change.
