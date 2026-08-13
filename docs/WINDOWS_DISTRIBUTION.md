# Official Windows distribution boundary

## Status

Metrora for Windows is available on the **Microsoft Store**, published by Vensent.

[Open Metrora on Microsoft Store](https://apps.microsoft.com/detail/9NXSZFQSBBDX)

The Microsoft Store package is the supported public Windows distribution. Repository builds and historical GitHub pre-releases remain separate development or archival artifacts and are not the recommended install path.

The currently published Store line is traceable to source candidate `1.0.0-rc.10`, desktop build version `1.0.0.10`, and Store AppX identity version `1.0.0.0`. Development on `main` may advance independently after that published line.

Historical 0.9.19 and RC7 acceptance material remains immutable evidence for those source lines only.

## Identity

An official distribution uses the exact Metrora product and publisher identity assigned to that channel. Identity values must not be guessed, copied from another product or changed after the reviewed package has been derived.

## Version boundary

Windows uses multiple version authorities deliberately:

- published Store source line: `1.0.0-rc.10`;
- published desktop build version: `1.0.0.10`;
- published Microsoft Store AppX identity version: `1.0.0.0`.

The Store AppX four-part identity is not the desktop build counter. See [Versioning authority](VERSIONING.md).

## Package requirements

An official Windows package must:

- derive from reviewed public Metrora source and the canonical bundled runtime;
- retain the local filesystem access required for supported usage sources;
- preserve endpoint identity, Workspace state and user-owned data;
- contain only declared product bytes and metadata;
- expose truthful product, publisher, version and channel information;
- remain traceable through checksums, manifests and provenance;
- pass clean installation, first launch, update, removal and rollback acceptance;
- keep private user data out of package metadata and reports.

## Historical GitHub previews

Unsigned GitHub pre-releases follow the separate source and acceptance rules in [Windows GitHub pre-release acceptance v1](WINDOWS_GITHUB_PRE_RELEASE_ACCEPTANCE_V1.md).

The existing RC7 release remains immutable as a historical technical preview. Later Store and source changes do not retroactively modify or re-label those artifacts, and the public Windows install path points to Microsoft Store instead.

## Microsoft Store distribution

The Store workflow derives an x64 AppX from reviewed source and validates its identity, architecture, capabilities and bundled runtime boundary. The Store manifest's four-part package identity remains separate from the desktop build counter.

The published Store line passed its source-bound package and physical-runtime acceptance before publication. Later source work remains separate until a future Store update is explicitly prepared and accepted.

## Accounting presentation boundary

Lifetime and historical model totals use durable local accounting so usage does not disappear when source tools expire old session files. Views that require source-only detail, such as task attribution, may cover only sessions that are still reconstructible and must identify that narrower scope instead of presenting it as complete historical accounting.

Presentation-sized top-N history must never silently become an accounting authority. Where old payloads retain only a top-N model list, any unrepresented remainder is shown as an explicit unattributed model-history gap rather than assigned to a named model or dropped from the total.

## Update acceptance gates

For each future official Windows Store update, verify:

1. product and publisher identity are exact;
2. first launch works without an external Node.js installation;
3. the bundled CLI starts from the packaged layout;
4. supported local usage sources remain discoverable;
5. existing endpoint and Workspace state are preserved safely;
6. installation channels do not collide or silently migrate one another;
7. update and rollback preserve user-owned local state;
8. public version and channel information are truthful;
9. no private data enters package metadata, reports or provenance;
10. published artifacts remain bound to reviewed public source.

## Responsibility boundary

Product build, package derivation, independent verification, channel publication and rollback remain separate responsibilities.