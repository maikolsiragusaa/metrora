# Official Windows distribution boundary

## Status

Metrora does not yet have an official stable Windows release.

The latest public Windows technical preview is the **unsigned** GitHub pre-release `v1.0.0-rc.7`. It remains bound to its accepted source, manifests, checksums and publication evidence. It is not a signed stable package, a Microsoft Store package or an automatic update channel.

The active source/pre-submission line is `1.0.0-rc.9`, with desktop build version `1.0.0.9`. RC9 advances RC8 after pre-submission review found two material issues: model-accounting surfaces needed an explicit durable-vs-surviving-detail boundary, and the Store AppX needed a self-contained CLI runtime rather than a loose scoped npm dependency tree.

Metrora has an assigned Microsoft Store identity and a reviewed non-publishing AppX workflow/local-test path. No Store submission, certification or publication is claimed until Microsoft actually accepts that channel.

Historical 0.9.19 acceptance material remains immutable engineering evidence for its own source line only.

## Identity

An official distribution must use the exact product and publisher identity issued for Metrora by the selected channel.

Identity values must never be guessed, copied from another project or patched into an artifact after the reviewed product build.

Protected credentials and verification material remain outside untrusted public pull-request workflows.

## Version boundary

Windows uses multiple version authorities deliberately:

- product/source candidate: `1.0.0-rc.9`;
- desktop build version: `1.0.0.9`;
- current non-publishing Microsoft Store AppX identity version: `1.0.0.0`.

The Store AppX four-part identity is not the desktop build counter. See [Versioning authority](VERSIONING.md).

## Package requirements

An official Windows package must:

- derive from reviewed public Metrora source and the canonical bundled runtime;
- retain the local filesystem access required for supported usage sources;
- preserve endpoint identity, Workspace state, secure-storage material and user-owned data;
- contain only declared product bytes and metadata;
- expose truthful product, publisher, version and channel information;
- remain independently traceable through checksums, manifests and provenance;
- pass clean installation, first launch, update, removal and rollback acceptance;
- keep private user data out of package metadata, reports and provenance.

## GitHub technical preview

An unsigned GitHub pre-release follows the separate source, candidate, physical and publication gates in [Windows GitHub pre-release acceptance v1](WINDOWS_GITHUB_PRE_RELEASE_ACCEPTANCE_V1.md).

The existing RC7 release remains immutable. Later Store-readiness changes do not retroactively modify or re-label those artifacts.

## Microsoft Store pre-submission

The Store workflow builds an unsigned AppX candidate and inspects its identity, architecture, capabilities and payload boundary without publishing it. The packaged CLI must be self-contained and must execute successfully from the extracted AppX payload using the packaged Electron runtime; a loose CLI `node_modules` tree is not an accepted Store runtime boundary. A separate copy may be signed with a temporary local certificate only for physical acceptance.

Before Partner Center submission, the exact source-bound candidate must pass the bounded local Store test and cleanup. A local PASS is pre-submission evidence only; it is not Microsoft certification.

## Accounting presentation boundary

Lifetime and historical model totals use durable local accounting so usage does not disappear when source tools expire old session files. Views that require source-only detail, such as task attribution, may cover only sessions that are still reconstructible and must identify that narrower scope instead of presenting it as complete historical accounting.

Presentation-sized top-N history must never silently become an accounting authority. Where old payloads retain only a top-N model list, any unrepresented remainder is shown as an explicit unattributed model-history gap rather than assigned to a named model or dropped from the total.

## Acceptance gates

Before official publication, verify on supported physical Windows systems:

1. product and publisher identity are exact;
2. first launch works without an external Node.js installation;
3. the CLI bundled in the Store payload starts and resolves its runtime dependencies from the packaged layout;
4. supported local usage sources remain discoverable;
5. intended migration reuses existing endpoint and Workspace state safely;
6. installation channels do not collide or silently migrate one another;
7. update and rollback preserve user-owned local state;
8. removal clears application authority while preserving local state by default;
9. public version and channel information are truthful;
10. no private data enters package metadata, reports or provenance;
11. published artifacts remain bound to reviewed public source.

## Responsibility boundary

Product build, package derivation, independent verification, channel submission, publication and rollback remain separate responsibilities. No single workflow receives unnecessary authority over all of them.
