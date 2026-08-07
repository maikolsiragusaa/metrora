# Releasing Metrora

Metrora does not yet have an official stable desktop release. This document defines the current public release boundary.

## Canonical identity

- Product: **Metrora**
- Domain: **metrora.eu**
- Repository: `maikolsiragusaa/metrora`
- Canonical command: `metrora`
- Current source candidate: `1.0.0-rc.9`
- Current desktop build version: `1.0.0.9`
- Latest published GitHub technical preview: `1.0.0-rc.7`

Temporary compatibility commands are governed by the technical compatibility register. They are not release brands or names for new artifacts.

The root npm package is private and must not be published from this repository.

## Current engineering authority

`1.0.0-rc.9` is the current **source/pre-submission candidate line**. It advances RC8 because accounting presentation and the packaged Store CLI runtime changed materially after physical pre-submission review. Its metadata does not by itself make any artifact accepted, signed, submitted or published.

`1.0.0-rc.7` remains the latest published GitHub Windows technical preview. That channel is unsigned, manually updated and not Microsoft Store certified. Its source, release assets, manifests and checksums remain immutable historical publication evidence.

The Microsoft Store path is separate. Metrora has an assigned Store identity and a non-publishing AppX build/local-acceptance workflow, but no Store certification or publication is claimed until Microsoft has accepted the corresponding submission.

Exact source commits and artifact digests belong in the applicable workflow/release acceptance evidence rather than being copied into general release guidance.

## Version authorities

Metrora deliberately separates three version forms:

- product/source SemVer: `1.0.0-rc.9`;
- desktop build version: `1.0.0.9`;
- Microsoft Store AppX package identity version for the `1.0.0` line: `1.0.0.0`.

The Store's four-component package identity is a platform contract and must not be confused with the desktop build counter or the SemVer pre-release label. See [`docs/VERSIONING.md`](docs/VERSIONING.md).

## Release responsibilities

An official desktop release proceeds through separate responsibilities:

1. freeze the public source commit and version;
2. run applicable tests, architecture and security gates;
3. assemble the canonical product payload;
4. derive declared platform formats and manifests;
5. verify artifact inventory and digests independently;
6. run platform and lifecycle acceptance;
7. apply the exact accepted distribution identity and protected signing authority where required;
8. publish artifacts, checksums, provenance and release notes;
9. update `metrora.eu` only after the relevant channel is accepted;
10. retain rollback authority and prior accepted artifacts.

Build, packaging, protected signing, publication and rollback must not be collapsed into one all-purpose workflow.

## Required validation

Run the checks owned by the affected surface, including where applicable:

```bash
npm ci
npm run build:cli
npm test -- --run
npm --prefix app ci
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run build
```

Platform workflows add their own manifest, payload, runtime, installation, update, rollback and state-preservation checks. The Store package check must execute the bundled CLI from the packaged AppX layout using the bundled Electron runtime; file presence alone is not sufficient.

## GitHub Windows pre-release

An unsigned Windows GitHub pre-release is a technical-evaluation channel. It is separate from Microsoft Store signing and certification.

The published `v1.0.0-rc.7` pre-release remains bound to its accepted source commit and release evidence. New source changes do not retroactively alter that release.

Any later GitHub pre-release must again come from one exact reviewed source commit and must pass the applicable candidate, artifact-binding and physical-acceptance boundaries before publication.

The public acceptance contract is [`docs/WINDOWS_GITHUB_PRE_RELEASE_ACCEPTANCE_V1.md`](docs/WINDOWS_GITHUB_PRE_RELEASE_ACCEPTANCE_V1.md). The immutable RC7 publication record is [`release/1.0.0-rc.7/GITHUB_PRE_RELEASE.md`](release/1.0.0-rc.7/GITHUB_PRE_RELEASE.md).

An unsigned GitHub pre-release must state that its portable/installer assets are unsigned, may trigger SmartScreen, require manual updates and are not Microsoft Store certified. It must not be presented as stable merely because GitHub represents it as a release object.

## Microsoft Store pre-submission

The Store candidate must be built from the exact reviewed source commit using the non-publishing Store workflow. Before Partner Center submission:

1. the exact AppX artifact and workflow manifest must verify;
2. Store identity, publisher, architecture, capabilities and package version must match reviewed configuration;
3. the packaged CLI must execute successfully from the AppX payload without a separately installed Node.js or a loose scoped `node_modules` runtime tree;
4. the unsigned submission candidate must remain byte-identical to the workflow output;
5. a separately test-signed copy may be used only for bounded local physical acceptance;
6. local-test package/certificate/private-key material must be removed afterward;
7. the sanitized local acceptance report must pass;
8. submission requires an explicit stop/go after those checks.

A passing local test is not Microsoft certification and does not authorize a publication claim.

## Versioning and notes

Metrora uses semantic versioning. The first independent candidate line is `1.0.0-rc.N`; the first official stable release is `1.0.0`. A release change updates every version-bearing package and generated metadata deliberately. See [`docs/VERSIONING.md`](docs/VERSIONING.md).

Every public release note states:

- version and source commit;
- distribution channel and format;
- signature status;
- supported operating-system scope;
- checksums and provenance location;
- migration or rollback constraints;
- known limitations;
- privacy-impacting changes, if any.

## Rollback

Do not rewrite or replace a broadly distributed release under the same version. Publish a new version and retain the previous accepted artifact long enough to support rollback.

Rollback preserves endpoint identity, OS-vault material, analytics, Workspace state, evidence, exports and user-owned local files according to the accepted migration contract.

## Platform boundary

- Windows is the first official desktop distribution target.
- macOS development artifacts remain ad-hoc signed and unnotarized until platform-specific trusted-distribution acceptance passes.
- Linux formats require packaging and support acceptance before official publication.
- Mobile distribution has its own signing and release boundary and does not replace desktop or Workspace authority.

## Prohibitions

- no `npm publish` from the private root package;
- no inherited upstream publication instructions presented as Metrora;
- no protected credentials in untrusted pull requests;
- no publication from an unverified local build;
- no silent replacement of accepted artifacts;
- no claim of Microsoft Store certification/publication before Microsoft actually accepts that channel;
- no claim of an official stable release before the relevant channel passes acceptance.
