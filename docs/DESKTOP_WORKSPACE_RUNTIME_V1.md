# Desktop Workspace runtime v1

**Status:** W1.D.A secure main-process boundary and W1.D.B focused desktop view are implemented. Explicit reviewed-production and lifecycle controls remain separate work before the complete W1.D experience is closed.

The desktop Workspace runtime exposes the already implemented local Workspace, reviewed evidence, signed-batch, and export capabilities to Electron without creating a second analytics engine or exposing endpoint secrets to the renderer.

## Authority split

The desktop keeps two explicit authorities:

- the existing CLI/menubar Overview payload remains authoritative for calls, sessions, token dimensions, costs, pricing coverage, model labels, source labels, project labels, filters, and periods;
- the private Workspace runtime is authoritative only for local Workspace identity, enrollment, evidence state, batch creation, and signed export.

The Workspace renderer combines those two read models. It never recalculates analytics totals from outbox events or signed batches.

## Main-process secret boundary

At Electron bootstrap:

1. one promise for the Workspace runtime is installed before the inherited desktop main module is loaded;
2. the existing OS-vault master-key envelope is opened through Electron `safeStorage`;
3. the existing endpoint identity is loaded once;
4. the master key is immediately zeroed;
5. the loaded signing key and event-identity key remain owned by the private main-process runtime;
6. `dispose()` zeroes both private buffers;
7. unsupported platforms or vault failures keep Workspace actions disabled without opening a plaintext fallback or blocking ordinary local analytics.

The runtime object is never exposed through `contextBridge`. Only strict public DTOs and bounded actions cross IPC.

## Public snapshot

`DesktopWorkspaceSnapshotV1` contains only:

- local-only status;
- public endpoint ID, identity generation, and public-key fingerprint;
- optional personal Workspace display data and active owner role;
- enrolled endpoint display/platform/software/capability data;
- honest evidence state and counts;
- explicit privacy flags.

It contains no analytics totals. It also excludes:

- private signing keys;
- event-identity/HMAC keys;
- OS-vault ciphertext or master key;
- data directories and internal file paths;
- raw deduplication keys or production receipts;
- prompts, responses, source code, patches, secrets, and tool arguments.

## Focused desktop view

The W1.D.B renderer adds a dedicated **Workspace** section and `Command-9` navigation without changing ordinary analytics behavior.

The view presents:

- local personal-Workspace identity and local-only status;
- active owner role and enrolled endpoint details;
- endpoint platform, software versions, identity generation, and public fingerprint;
- honest reviewed-evidence state, pending/acknowledged/quarantined counts, and blockers;
- the explicit privacy boundary;
- current cost, calls, sessions, input/output tokens, cache-read/cache-write tokens, and pricing coverage;
- the exact active period, provider, custom-range, and Claude-config scope already selected in the desktop shell.

`workspaceUsageFromOverview()` is intentionally a field-for-field projection of the current Overview payload. It performs no aggregation, repricing, relabeling, event reconstruction, or batch reconstruction. Focused tests lock every displayed analytics field to the corresponding Overview field.

Opening the view performs only a public Workspace-status read. It does not scan collectors, produce reviewed measurements, sign a batch, open a save dialog, upload data, or publish anything automatically.

## Actions

The renderer may request:

- current Workspace status;
- explicit creation of the personal Workspace;
- creation of the next workspace-authorized signed batch;
- export of the current independently verifiable Workspace evidence package.

Creation remains explicit. The runtime derives a valid slug only when the user does not supply one and reuses the enrolled endpoint identity.

The reviewed adapter-set digest placed in new batches is derived deterministically from the executable provenance profile registry. It is not an arbitrary UI or Electron constant.

The renderer disables signing and export when the public evidence state reports a blocking or quarantined condition. Runtime failures are shown as bounded user-facing outcomes rather than raw exception text.

## Export path privacy

Electron main opens the native save dialog and passes the selected absolute path only to the private runtime. The renderer receives:

- `cancelled`, or
- the exported filename, verification summary, and refreshed public Workspace snapshot.

The full local path never crosses IPC and is never embedded in the evidence artifact.

## IPC and compatibility

Workspace handlers are registered in an isolated Electron module rather than being inserted into the inherited CLI analytics bridge. Canonical `metrora:*` channels are exposed together with temporary compatibility aliases.

All handlers:

- wait for the same one-time runtime initialization promise;
- return structured envelopes rather than throwing across IPC;
- validate user input before invoking the private runtime;
- map unsupported, unavailable, recovery, blocked, and unknown failures to bounded messages;
- never forward raw exception text or local paths.

## Non-goals

- no alternate analytics calculation or total store;
- no automatic collector scan or reviewed measurement production;
- no automatic batch creation, export, upload, or publication;
- no uploader, synchronization, network, account, team, invitation, entitlement, billing, or retention service;
- no Android, Advisor, or Bench behavior;
- no collector, parser, pricing, label, session-cache, or aggregation mutation.

## Remaining W1.D work

The focused W1.D.B screen does not by itself close the complete desktop Workspace experience. A later bounded tranche must expose reviewed-measurement production explicitly and settle honest pause/recovery controls without weakening the main-process secret boundary, duplicating analytics, or introducing hosted dependencies.
