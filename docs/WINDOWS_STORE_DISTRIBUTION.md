# Windows Store distribution

## Decision

Metrora uses two parallel Windows channels:

- Microsoft Store AppX/MSIX for ordinary users;
- GitHub Releases and metrora.eu for the portable ZIP and unsigned NSIS installer used by technical users.

The Store channel is the recommended public path because Microsoft hosts, signs and updates the packaged application after certification. The GitHub channel remains available without requiring a Microsoft account or Store access.

## Current status

The accepted Windows 0.9.19 authority remains the unsigned portable and NSIS candidate validated through R1.B physical acceptance.

The Store package does not exist yet. It requires a separately reserved Partner Center product identity and its own build, verification and physical acceptance.

## Store identity

Do not guess or copy Store metadata from CodeBurn or any other upstream project.

After the Metrora product is reserved in Partner Center, record the exact public values supplied by Microsoft:

- package identity name;
- publisher CN;
- publisher display name;
- Store product ID;
- official Store URL.

No payment or external code-signing certificate is authorized.

## Packaging model

The planned Store package is a separate electron-builder AppX target built on Windows x64 from the same reviewed Metrora source and bundled CLI as the desktop application.

The package must:

- retain full-trust desktop execution required to read local AI-tool session files;
- keep prompts, responses, source code and private paths local;
- preserve endpoint identity, Workspace state, safe-storage material and user-owned data;
- contain only Metrora product bytes and declared metadata;
- remain unsigned before Partner Center upload;
- be signed by Microsoft during Store certification;
- never be presented as suitable for direct sideloading unless a separate trusted signing path exists.

## Parallel GitHub channel

GitHub Releases may contain:

- the verified portable ZIP;
- the unsigned NSIS installer;
- SHA-256 checksums;
- release and format manifests;
- explicit installation guidance for SmartScreen.

The unsigned GitHub files must never be described as Microsoft-signed or equivalent to the Store package.

## Acceptance gates

Before Store publication, verify on physical Windows:

1. Store package identity and displayed publisher are correct.
2. First launch works without an external Node.js installation.
3. Supported provider session files remain discoverable.
4. Existing endpoint and Workspace state are reused safely where migration is intended.
5. A clean Store install does not collide with the NSIS installation.
6. Update preserves all user-owned local state.
7. Uninstall removes application authority while preserving local state by default.
8. Store and GitHub channels expose truthful version and channel information.
9. No private data enters Store metadata, reports or provenance.

## Architecture boundary

Store build, Store submission, GitHub release publication and incident rollback remain separate responsibilities. Do not combine them into one all-purpose workflow.
