# Metrora sync

`metrora sync` is an **explicit, opt-in** path for sending usage telemetry to a remote endpoint that you configure. It is not required for local Metrora use and it does not run automatically.

Prompts, response bodies, source code, diffs, shell commands and secrets are not included in the sync payload.

## Quick start

```bash
# One-time setup (opens a browser for login)
metrora sync setup https://metrics.your-team.com

# Push recent usage explicitly
metrora sync push

# Check local sync status
metrora sync status
```

## Commands

### `metrora sync setup <url>`

Configures one remote endpoint and performs an OIDC login.

```bash
metrora sync setup https://metrics.your-team.com
```

The client:

1. fetches the endpoint discovery document;
2. opens the configured identity-provider login page;
3. stores the refresh token using the platform credential backend;
4. stores non-secret endpoint configuration in the Metrora config root.

Fresh installations use `~/.config/metrora` on platforms that follow the XDG-style layout. An existing Metrora or Metrora config root is adopted in place rather than abandoned, so an upgrade does not silently lose configuration.

The v1 server contract still uses `/.well-known/metrora-export.json` as a **frozen compatibility wire route**. That route name is not the product identity and must not be used for new UI, commands or branding.

### `metrora sync push`

Sends only unsent usage records in the requested window to the configured endpoint.

```bash
metrora sync push
metrora sync push --since 30d
metrora sync push --dry-run
```

No background scheduler or automatic Store upload is enabled by this command set.

### `metrora sync status`

Shows the configured endpoint, authentication state, credential-storage method and last successful push.

### `metrora sync logout`

Removes the local sync credential and endpoint configuration.

```bash
metrora sync logout
```

### `metrora sync reset --confirm`

Clears the local sent-ledger. The next explicit push can therefore resend records in its selected window.

```bash
metrora sync reset --confirm
```

## What is sent

Each eligible interaction is encoded as an OTLP span using metadata such as provider, model, token counts, cost attribution and project label when available. A pseudonymous device identifier distinguishes endpoints without transmitting the machine hostname as the identifier.

The sync payload does **not** include:

- prompt or response bodies;
- source-code contents or diffs;
- shell-command text;
- secrets or API keys;
- unrestricted local paths.

This privacy boundary is structural; there is no command-line flag that turns those fields on.

## Authentication and local storage

Sync uses OIDC Authorization Code + PKCE. Credential handling is platform-specific:

- macOS: Keychain;
- Linux: libsecret when available, otherwise a permission-restricted file fallback;
- Windows: DPAPI-protected local credential storage.

Fresh credential/config files use the canonical Metrora config root. Existing compatibility roots remain readable so upgrades do not strand credentials or settings.

## Operational behavior

`metrora sync push` is idempotency-aware through a local sent-ledger. Successfully sent record identities are retained so an overlapping later push does not intentionally duplicate them. The ledger follows the canonical Metrora cache root on fresh installations and adopts an existing legacy cache root in place when present.

When the machine is offline, nothing is uploaded. A later explicit push can use a larger `--since` window to catch up.

For the versioned wire contract and test architecture, see [DEVELOPER.md](DEVELOPER.md).
