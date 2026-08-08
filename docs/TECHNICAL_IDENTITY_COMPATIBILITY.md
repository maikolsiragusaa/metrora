# Metrora technical identity compatibility

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

## Compatibility boundary

The repository retains a narrowly scoped read-only compatibility boundary for
older installations and integrations that would otherwise strand user-owned
state. It is implemented only in:

- `app/electron/identity.ts` and `app/electron/cli.ts` for legacy executable,
  environment-variable and persisted-pointer lookup;
- `src/product-paths.ts` for existing config/cache roots;
- `app/renderer/lib/storage.ts` for existing local-storage keys;
- the package `bin` map for an old command-line shim.

The precedence is always canonical first. New files, writes, IPC messages,
preload globals, diagnostics and release artifacts use Metrora names only.
Legacy values are read or adopted in place, never emitted as current product
identity, and are not deleted automatically. The compatibility tests document
the exact precedence and migration behavior at each boundary.

## Local-state adoption

- `METRORA_DATA_DIR` wins when defined.
- Fresh config and cache paths use the canonical Metrora roots.
- An existing legacy root is adopted in place when the canonical root is not
  present, preserving durable user history without silently replacing it.
- Desktop endpoint state is read from an explicitly supplied legacy data root
  only for controlled migration callers; no old product namespace is inferred
  from a new installation.
- Existing canonical files are never overwritten.
- No migration performs telemetry or uploads data.

## Versioned identifiers

Current v1 evidence, local-state records and wire contracts use the canonical
Metrora namespace. Their identifiers are protocol provenance, not visible
branding. Signed or hashed records are not rewritten in place; a future
namespace change must be introduced as an explicit versioned migration that
preserves verification semantics.

## Removal criteria

The compatibility boundary can be removed only after a stable Metrora release
has shipped with adoption support, rollback no longer depends on it, release
notes have announced the removal, and tests prove that supported local state no
longer requires the aliases. Removal must be a separate reviewed change.
