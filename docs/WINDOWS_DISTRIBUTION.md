# Official Windows distribution boundary

## Status

Metrora for Windows is available on the **Microsoft Store**, published by Vensent.

[Open Metrora on Microsoft Store](https://apps.microsoft.com/detail/9NXSZFQSBBDX)

The Microsoft Store package is the supported public Windows distribution. Repository builds and historical GitHub pre-releases remain separate development or archival artifacts and are not the recommended install path.

The currently published Store line is traceable to source candidate `1.0.0-rc.11`, desktop build version `1.0.0.11`, and Store AppX identity version `1.0.1.0`. RC11 was accepted through Microsoft certification and published as the Store update. The previous RC10 line (`1.0.0-rc.10`, Desktop `1.0.0.10`, Store `1.0.0.0`) remains immutable historical publication evidence. Development on `main` may advance independently after the published RC11 line.

Historical 0.9.19, RC7 and RC10 acceptance material remains immutable evidence for those source lines only.

## Identity

An official distribution uses the exact Metrora product and publisher identity assigned to that channel. Identity values must not be guessed, copied from another product or changed after the reviewed package has been derived.

## Version boundary

Windows uses multiple version authorities deliberately:

- current published Store source line: `1.0.0-rc.11`;
- current published desktop build version: `1.0.0.11`;
- current published Microsoft Store AppX identity version: `1.0.1.0`;
- previous published Store source line: `1.0.0-rc.10`;
- previous published desktop build version: `1.0.0.10`;
- previous published Store AppX identity version: `1.0.0.0`.

The Store AppX four-part identity is not the desktop build counter. The machine-readable packaging authority in `release/windows-store-package-version.v1.json` records the RC10-to-RC11 package-version transition used to derive this update. It must be advanced under a separately reviewed future Store-candidate decision before another Store package is derived; RC11 publication does not itself authorize RC12 or any later package version. See [Versioning authority](VERSIONING.md).

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

RC10 established the first published Store line. RC11 subsequently passed the source/package submission boundary, Microsoft certification and publication, and is now the current Store update. Later source work remains separate until a future Store update is explicitly reviewed, certified, published and made available.

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

The RC10-to-RC11 Store publication is complete. Any separate Founder-run physical profile-preservation/update reproduction remains acceptance evidence rather than a prerequisite for truthfully stating Microsoft's publication result; the repository does not claim to simulate or control Microsoft Store-managed rollout behavior.

## Responsibility boundary

Product build, package derivation, independent verification, channel publication and rollback remain separate responsibilities.
