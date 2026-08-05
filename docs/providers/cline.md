# Cline

Cline VS Code extension and Cline home-data task storage.

- **Source:** `src/providers/cline.ts`
- **Loading:** eager (`src/providers/index.ts:2`)
- **Test:** `tests/providers/cline.test.ts`

## Where it reads from

These task roots are scanned:

1. VS Code extension globalStorage for `saoudrizwan.claude-dev` in stable VS Code, VS Code Insiders, and VSCodium. Platform paths come from `getVSCodeGlobalStoragePaths` in `src/providers/vscode-cline-parser.ts`.
2. Cline's home-data root at `~/.cline/data`.

Every root is expected to contain a `tasks/` child directory. Discovery is delegated to `discoverClineTasks` in `src/providers/vscode-cline-parser.ts`, so a task is only included when it has a `ui_messages.json` file.

## Storage format

Per-task directories with:

```
tasks/<taskId>/
  ui_messages.json
  api_conversation_history.json
  task_metadata.json
```

`ui_messages.json` provides the `api_req_started` usage entries. `api_conversation_history.json` is used for model extraction. See [`vscode-cline-parser`](vscode-cline-parser.md) for the full schema description.
`task_metadata.json` is part of Cline's task layout but is not read by Metrora today.

## Caching

The shared session cache fingerprints Cline's collector version. Discovery changes advance that provider-scoped authority so surviving tasks are selected and parsed again without resetting unrelated providers.

Cline's collector authority also participates in the daily-cache configuration hash. When storage coverage changes, source-backed days are re-derived through the normal backfill and reconciliation path while sourceless historical slices remain carried.

## Deduplication

Discovery deduplicates by task id across every Cline root so a migrated or replicated task is not scanned twice. If the same task id exists in multiple roots, the one with the newest `ui_messages.json` wins. Parsing still uses the shared per-call key: `<providerName>:<taskId>:<index>`.

## Quirks

- This provider is intentionally a thin wrapper over the shared Cline-family parser.
- Cline can keep data in VS Code stable, Insiders, VSCodium, and `~/.cline/data`, depending on version and workflow. All roots are scanned without summing duplicate task IDs.
- If Cline changes the JSON shape, fix `vscode-cline-parser.ts` only if Roo Code and KiloCode still pass. Branch provider-specific parsing rather than duplicating the whole parser.

## When fixing a bug here

1. Reproduce with a minimal task directory containing `ui_messages.json` and `api_conversation_history.json`.
2. Run `tests/providers/cline.test.ts`, plus `tests/providers/roo-code.test.ts` and `tests/providers/kilo-code.test.ts` if the shared parser changes.
3. Keep the provider name `cline`; downstream filters and dedup keys depend on it.
