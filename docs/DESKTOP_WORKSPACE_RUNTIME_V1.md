# Desktop Workspace runtime v1

**Status:** implemented as the W1.D.A main-process boundary; the Workspace screen follows in a separate tranche.

The desktop Workspace runtime exposes the already implemented local Workspace, reviewed evidence, signed-batch, and export capabilities to Electron without creating a second analytics engine or exposing endpoint secrets to the renderer.

## Authority split

The desktop keeps two explicit authorities:

- the existing CLI/menubar analytics payload remains authoritative for calls, sessions, token dimensions, costs, model labels, source labels, project labels, filters, and periods;
- the private Workspace runtime is authoritative only for local Workspace identity, enrollment, evidence state, batch creation, and signed export.

The Workspace renderer must combine those two read models. It must never recalculate analytics totals from outbox events or signed batches.

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

## Actions

The renderer may request:

- current Workspace status;
- explicit creation of the personal Workspace;
- creation of the next workspace-authorized signed batch;
- export of the current independently verifiable Workspace evidence package.

Creation remains explicit. The runtime derives a valid slug only when the user does not supply one and reuses the enrolled endpoint identity.

The reviewed adapter-set digest placed in new batches is derived deterministically from the executable provenance profile registry. It is not an arbitrary UI or Electron constant.

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

- no Workspace screen in this tranche;
- no analytics calculation or alternative total store;
- no automatic collector scan or reviewed measurement production;
- no uploader, synchronization, network, account, team, invitation, entitlement, billing, or retention service;
- no Android, Advisor, or Bench behavior;
- no collector, parser, pricing, label, session-cache, or aggregation mutation.

## Next tranche

W1.D.B adds one focused desktop Workspace view and explicit create, batch, and export interactions. Usage cards must reuse the same canonical Overview payload and active period/filter scope as the rest of the desktop, with tests proving exact field-by-field reconciliation.