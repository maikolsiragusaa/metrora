# Provider quota authority

Metrora treats provider-reported quota, Metrora-measured usage, and user-configured budget plans as three different concepts. A provider quota window is a fact from the provider endpoint; local token, call, and cost history cannot fabricate or backfill it. A missing provider response is shown as unavailable or stale, never as a zero-valued quota.

The Electron live-quota path exposes one JSON-safe `ProviderQuotaSnapshot` contract. It records `authority: "provider-reported"`, connection and freshness state, the original `observedAt`, stable window IDs, normalized `usedFraction` values, provider reset boundaries, structured Codex credits, and rate-limit backoff state. Pace is a separate interpretation of a known provider window and is fail-closed when its timing evidence is missing or malformed.

Codex and Claude quota reads are observational. Electron reads provider-owned credentials, retries one time after a 401 only when the owner has rotated the access token, and never refreshes or writes provider credential files. Metrora-owned backoff state may still be persisted. Renderer IPC applies a product-field allowlist so tokens, account identifiers, credential JSON, and credential paths cannot cross the bridge.

This first convergence covers Codex and Claude only. It does not add quota to Companion/mobile payloads, invent quota for unsupported providers, redesign Plans navigation, change usage accounting or pricing, or rewrite the native macOS services. The current macOS Codex credential lifecycle and its legacy quota presentation require a parity follow-up before the platforms can share this contract completely.
