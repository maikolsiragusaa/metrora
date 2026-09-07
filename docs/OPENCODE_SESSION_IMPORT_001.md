# OPENCODE_SESSION_IMPORT_001

## Closeout

Base main: `0c24a8e495848bb3d5e71e4924dff56e24b185d5`

Branch: `feat/opencode-session-import-001`

HEAD: `0c24a8e495848bb3d5e71e4924dff56e24b185d5` before the feature commit

PR: draft pending push

Standalone version tested: `1.18.29`

Metrora OpenCode version: `1.18.27` (`b04697366f05419e9bd7a92f841813dd976161c9`)

Official export used: YES — `opencode export <sessionID>`

Official import used: YES — `opencode import <file>`

Cross-version export/import: PASS

Standalone session discovery: PASS — bounded SQLite metadata read found the real standalone store without deserializing transcripts.

New-session comparison: PASS — canonical IDs only; overlaps are `alreadyPresent` and are never sent to import.

First import:

- discovered: 1
- new: 1
- imported: 1
- already present: 0
- skipped: 0
- failed: 0

Second import:

- imported: 0
- already present: 1
- duplicates created: 0

Transcript preserved: PASS — the 1.18.29 export contained 37 messages, 104 parts, 24 text parts, 12 tool parts, and 12 tool states; all were present after pinned 1.18.27 import.

Imported session usable: PASS — the imported session and its message/part/tool records remained readable from the pinned destination store.

Restart persistence: PASS — a new process reopened the disposable pinned destination and found the imported session; a provider-backed new prompt was intentionally not sent.

Standalone source mutated by Metrora: NO on the product path — the live standalone DB SHA-256 was unchanged before/after the snapshot-backed importer run. A separate diagnostic direct invocation of the upstream CLI against the live DB updated upstream project bookkeeping; that unsafe diagnostic was not accepted as product behavior and is the reason the implementation snapshots the source first.

Metrora isolated DB preserved: YES

Shared DB restored: NO

Accounting overlap dedup: PASS — the existing OpenCode source-union regression suite still counts overlapping standalone/Metrora evidence once.

New Metrora prompt counted once: NOT RUN — no provider-backed prompt was issued against the founder account.

Temp artifacts cleaned: PASS — export JSON, source snapshot, and isolated command roots are removed in success and failure paths. Disposable validation directories remain outside the repository under the OS temp folder for manual cleanup.

Tests:

- Desktop: 96 files, 804 tests passed
- Repository: 353 files passed, 2 skipped; 3,419 tests passed, 5 skipped
- Importer/runtime/storage/resolver tests: 45 tests passed
- OpenCode source-union regression: 3 tests passed

Typecheck: PASS — `npm run typecheck` from `app`

Build: PASS — root CLI build, Electron TypeScript build, and renderer Vite build

Source-size: PASS — `SOURCE_SIZE_BASE_REF=origin/main node scripts/check-source-size-ratchet.mjs`

Architecture: PASS — public identity boundary, Windows Store identity/version, and source-size boundary checks

Commit: `feat: import standalone OpenCode sessions` (pending)

Push: pending

Merge: NOT PERFORMED

STOP.

## Boundary implemented

The standalone authority is discovered portably and used only for metadata discovery and official export. The export command runs against a read-only SQLite `VACUUM INTO` snapshot under Metrora-owned temporary storage, because the upstream CLI bootstraps project bookkeeping even for export. The source WAL is never copied or published.

The pinned Metrora runtime is the only import authority. It receives the existing Metrora runtime path and environment contract, is run only while the Metrora sidecar is cleanly stopped, and writes only the Metrora-owned isolated database. The WebContentsView is disposed and restarted around maintenance, while renderer IPC accepts no paths, executable names, or arguments.

The import action is explicit, one-way, single-flight, ID-idempotent, directory-aware, bounded, and returns safe reason enums. It does not modify upstream OpenCode UI, add synchronization, merge existing sessions, or expose export JSON to telemetry/logs.

The upstream command implementation audited for this work is [export.ts](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.29/packages/opencode/src/cli/cmd/export.ts) and [import.ts](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.29/packages/opencode/src/cli/cmd/import.ts).
