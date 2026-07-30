# Cline

Cline VS Code extension and Cline home-data task storage.

- **Source:** `src/providers/cline.ts`
- **Loading:** eager (`src/providers/index.ts:2`)
- **Test:** `tests/providers/cline.test.ts`

## Where it reads from

Two task roots are scanned:

1. VS Code extension globalStorage for `saoudrizwan.claude-dev`.
2. Cline's home-data root at `~/.cline/data`.

Both roots are expected to contain a `tasks/` child directory. Discovery is delegated to `discoverClineTasks` in `src/providers/vscode-cline-parser.ts`, so a task is only included when it has a `ui_messages.json` file.

## Storage format

Per-task directories with:

```
tasks/<taskId>/
  ui_messages.json
  api_conversation_history.json
  task_metadata.json
```

`ui_messages.json` provides the `api_req_started` usage entries. `api_conversation_history.json` is used for model extraction. See [`vscode-cline-parser`](vscode-cline-parser.md) for the full schema description.
`task_metadata.json` is part of Cline's task layout but is not read by CodeBurn today.

## Caching

None at the provider level; delegates to the shared helper and normal parser/cache layers.

## Deduplication

Discovery deduplicates by task id across the two Cline roots so a migrated task is not scanned twice. If the same task id exists in multiple roots, the one with the newest `ui_messages.json` wins. Parsing still uses the shared per-call key: `<providerName>:<taskId>:<index>`.

## Quirks

- This provider is intentionally a thin wrapper over the shared Cline-family parser.
- Cline can keep data in both VS Code globalStorage and `~/.cline/data`, depending on version and workflow.
- If Cline changes the JSON shape, fix `vscode-cline-parser.ts` only if Roo Code and KiloCode still pass. Branch provider-specific parsing rather than duplicating the whole parser.

## When fixing a bug here

1. Reproduce with a minimal task directory containing `ui_messages.json` and `api_conversation_history.json`.
2. Run `tests/providers/cline.test.ts`, plus `tests/providers/roo-code.test.ts` and `tests/providers/kilo-code.test.ts` if the shared parser changes.
3. Keep the provider name `cline`; downstream filters and dedup keys depend on it.
