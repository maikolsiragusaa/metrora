# Qovrion technical identity compatibility

Qovrion is the canonical product and technical identity. CodeBurn-derived names remain available only as temporary compatibility aliases for existing installations and integrations.

## Canonical names

- CLI command: `qovrion`
- Desktop bridge: `window.qovrion`
- IPC prefix: `qovrion:`
- Environment variables: `QOVRION_*`
- Renderer storage prefix: `qovrion.`
- Desktop CLI pointer directory: `Qovrion`

## Compatibility aliases

During the compatibility window, Qovrion also accepts:

- CLI command `codeburn`
- desktop bridge `window.codeburn`
- IPC prefix `codeburn:`
- environment variables `CODEBURN_*`
- renderer storage prefix `codeburn.`
- the previous CodeBurn CLI pointer location

The canonical form always has precedence when both are present. An explicitly empty canonical environment value is still authoritative.

## Persistence and rollback rules

- A valid legacy CLI pointer may be copied to the canonical Qovrion location once.
- The legacy pointer is never changed or deleted automatically.
- Renderer settings are copied from legacy keys when no canonical value exists.
- New renderer writes are mirrored to both generations during the compatibility window, so an older binary can still read current settings after a rollback.
- Automatic migration never overwrites an existing canonical value.
- Automatic migration never deletes a legacy value.
- An explicit user action that removes a setting may remove both forms because that mirrors the user's intent.

## Removal criteria

A legacy alias can be removed only after all of the following are true:

1. at least one stable Qovrion release has shipped with the migration enabled;
2. migration telemetry is not required and no user data is transmitted to evaluate adoption;
3. release notes have announced the deprecation clearly;
4. rollback no longer requires the legacy name;
5. tests prove that no supported installation path or local data depends on the alias;
6. the removal is delivered as a separate, reviewable change rather than bundled with product features.

No alias is removed by QOV-002.

## Privacy boundary

This compatibility layer is local. It does not activate product telemetry, inherited update services, or any new network request.
