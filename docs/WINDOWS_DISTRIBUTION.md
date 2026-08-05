# Official Windows distribution boundary

## Status

Official Windows distribution is in preparation.

The accepted 0.9.19 Windows artifacts remain unsigned engineering candidates used for validation. They are not an official release, signed package or active update channel.

The active source line is `1.0.0-rc.5`, with numeric desktop build version `1.0.0.5`. It does not have an accepted artifact yet and does not supersede the source-bound 0.9.19 evidence.

## Identity

An official distribution must use the exact product and publisher identity issued for Metrora by the selected channel.

Identity values must never be guessed, copied from another project or patched into an artifact after the reviewed product build.

Protected credentials and verification material remain outside untrusted public pull-request workflows.

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

## Technical artifacts

Portable and installer candidates may be published only as clearly labelled technical artifacts with their exact signature status, checksums and source binding.

They must not be described as an official signed distribution or as equivalent to a channel-certified package.

## Acceptance gates

Before official publication, verify on supported physical Windows systems:

1. product and publisher identity are exact;
2. first launch works without an external Node.js installation;
3. supported local usage sources remain discoverable;
4. intended migration reuses existing endpoint and Workspace state safely;
5. installation channels do not collide or silently migrate one another;
6. update and rollback preserve user-owned local state;
7. removal clears application authority while preserving local state by default;
8. public version and channel information are truthful;
9. no private data enters package metadata, reports or provenance;
10. published artifacts remain bound to reviewed public source.

## Responsibility boundary

Product build, package derivation, independent verification, channel submission, publication and rollback remain separate responsibilities. No single workflow receives unnecessary authority over all of them.
