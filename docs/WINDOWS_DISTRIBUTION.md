# Official Windows distribution boundary

## Status

Metrora for Windows is available on the **Microsoft Store**, published by Vensent.

[Open Metrora on Microsoft Store](https://apps.microsoft.com/detail/9NXSZFQSBBDX)

The Microsoft Store package is the supported public Windows distribution. Repository builds and historical GitHub pre-releases remain separate development or archival artifacts and are not the recommended install path.

The currently published Store line is traceable to source candidate `1.0.0-rc.10`, desktop build version `1.0.0.10`, and Store AppX identity version `1.0.0.0`. The current post-RC10 engineering candidate is `1.0.0-rc.11`, desktop build `1.0.0.11`, and Store AppX identity `1.0.1.0`; it is not published. Development on `main` may advance independently after that published line.

Historical 0.9.19 and RC7 acceptance material remains immutable evidence for those source lines only.

## Identity

An official distribution uses the exact Metrora product and publisher identity assigned to that channel. Identity values must not be guessed, copied from another product or changed after the reviewed package has been derived.

## Version boundary

Windows uses multiple version authorities deliberately:

- published Store source line: `1.0.0-rc.10`;
- published desktop build version: `1.0.0.10`;
- published Microsoft Store AppX identity version: `1.0.0.0`.
- current candidate source line: `1.0.0-rc.11`;
- current candidate desktop build version: `1.0.0.11`;
- current candidate Store AppX identity version: `1.0.1.0`.

The Store AppX four-part identity is not the desktop build counter. The
published baseline and candidate are maintained in
`release/windows-store-package-version.v1.json`. See [Versioning authority](VERSIONING.md).

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

The Store workflow derives an x64 AppX from reviewed source and validates its identity, architecture, capabilities and bundled runtime boundary. It also imports `app/resources/cli.asar/dist/desktop-share-runtime.js` through the bundled Electron runtime and requires `createDesktopShareRuntime` without starting a listener. The Store manifest's four-part package identity remains separate from the desktop build counter.

The published Store line passed its source-bound package and physical-runtime acceptance before publication. RC11 is currently prepared only as a candidate; later source work remains separate until a future Store update is explicitly physically accepted, submitted and published.

## Accounting presentation boundary

Lifetime and historical model totals use durable local accounting so usage does not disappear when source tools expire old session files. Views that require source-only detail, such as task attribution, may cover only sessions that are still reconstructible and must identify that narrower scope instead of presenting it as complete historical accounting.

Presentation-sized top-N history must never silently become an accounting authority. Where old payloads retain only a top-N model list, any unrepresented remainder is shown as an explicit unattributed model-history gap rather than assigned to a named model or dropped from the total.

## Update acceptance gates

For each future official Windows Store update, verify:

1. product and publisher identity are exact;
2. first launch works without an external Node.js installation;
3. the bundled CLI starts from the packaged layout;
4. the packaged companion runtime imports from the exact AppX ASAR path;
5. supported local usage sources remain discoverable;
6. existing endpoint and Workspace state are preserved safely;
7. installation channels do not collide or silently migrate one another;
8. update and rollback preserve user-owned local state;
9. public version and channel information are truthful;
10. no private data enters package metadata, reports or provenance;
11. published artifacts remain bound to reviewed public source.

The controlled RC10-to-RC11 update/profile-preservation test remains a deferred
Founder-run acceptance step. The repository currently performs only the safe
machine-verifiable package-version ordering check; it does not install over a
real Store package or claim Microsoft Store-managed update certification.

## Responsibility boundary

Product build, package derivation, independent verification, channel publication and rollback remain separate responsibilities.
