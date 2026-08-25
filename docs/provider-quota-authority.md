# Provider quota authority

Metrora treats provider-reported quota, Metrora-measured usage, and user-configured budget plans as three different concepts. A provider quota window is a fact from a provider-owned surface; local token, call, and cost history cannot fabricate or backfill it. A missing provider response is shown as unavailable or stale, never as a zero-valued quota.

The Electron live-quota path exposes one JSON-safe `ProviderQuotaSnapshot` contract. It records `authority: "provider-reported"`, connection and freshness state, the original `observedAt`, stable window IDs, normalized `usedFraction` values, provider reset boundaries when supplied, structured credits when supplied, and rate-limit backoff state. Pace is a separate interpretation of a known provider window and is fail-closed when its timing evidence is missing or malformed.

Transport provenance is separate from factual authority. A snapshot may identify a documented provider API, provider-owned CLI state, a local provider service, or a bounded internal provider API. Experimental/internal transport is labelled as such in Provider details; it does not become stronger evidence merely because the payload is provider-reported. Unknown or malformed provenance metadata is dropped at the renderer boundary rather than upgraded.

Current desktop capacity observation covers:

- **Codex** — read-only provider-owned ChatGPT/Codex OAuth usage;
- **Claude** — read-only Claude Code OAuth usage;
- **GitHub Copilot** — Provider client/internal API · Experimental, using existing provider-owned credential state;
- **Kimi Code** — existing Kimi Code CLI credential state with the fixed coding usage endpoint, marked experimental;
- **Antigravity** — an already-running local Antigravity service discovered through bounded platform-specific process/port inspection, marked experimental.

Quota reads are observational. Metrora does not refresh or rewrite provider credentials in this path. Provider-owned credential rotation may be observed through one bounded reread after authentication failure where the adapter supports it. Antigravity V1 does not spawn or manage the provider CLI and does not add Google OAuth. Copilot V1 does not create a GitHub device-flow login, import browser cookies, or store a new GitHub token. Kimi V1 does not spend its refresh token. Metrora-owned backoff state may still be persisted.

Copilot's internal API response is compatibility/observational evidence, not a stronger authority than a supported documented provider source. Unlimited, unmetered, token-billed, placeholder, or otherwise insufficient Copilot quota states remain unavailable rather than being represented as zero usage. A future documented provider source may supersede this experimental transport without changing the canonical quota contract.

Renderer IPC applies a product-field allowlist so tokens, account identifiers, credential JSON, credential paths, local process command lines, local ports, and CSRF values cannot cross the bridge. Provider source details expose only the bounded source class and stability label.

This expansion does not add Capacity to Companion/mobile payloads, invent quota for unsupported providers, conflate quota with local budgets, change usage accounting or pricing, or change the parked native macOS parity work. Additional providers must enter through the same source hierarchy and `ProviderQuotaSnapshot` contract rather than introducing provider-specific UI authority.
