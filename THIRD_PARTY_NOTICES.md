# Third-party notices

Metrora includes third-party and upstream-licensed components. Those components retain their original copyright notices and licence terms.

## Incorporated MIT component

Portions of Metrora were derived from an upstream source snapshot at commit
`146037bfd533edff85cd39f322571b2c5434fcca`.

The original copyright notice and complete MIT licence text are preserved in
[`LICENSES/UPSTREAM-MIT.txt`](LICENSES/UPSTREAM-MIT.txt).

Source repository: `https://github.com/getagentseal/codeburn`

Later provider-capacity work selectively adapts bounded MIT-licensed behavior and parsing lessons from reviewed CodeBurn revisions through `b305378e351ebb6a401e3de8f48af2565608fd3e`. Metrora keeps its own `ProviderQuotaSnapshot`, credential policy, source hierarchy, Windows discovery behavior, stale/backoff semantics, and product presentation rather than synchronizing the upstream implementation wholesale.

## CodexBar capacity reference

Provider-capacity source strategies and compatibility behavior were also reviewed against `steipete/CodexBar` at commit `0a1aa53598c94003a87bcdcca4af88b0ad508421` and selectively adapted where useful. Metrora does not incorporate CodexBar as a runtime dependency and does not adopt its browser-cookie, localStorage, password-login, account-store, or application lifecycle wholesale.

The CodexBar upstream work is MIT licensed. Its original copyright notice and complete MIT licence text are preserved in [`LICENSES/CODEXBAR-MIT.txt`](LICENSES/CODEXBAR-MIT.txt).

Source repository: `https://github.com/steipete/CodexBar`

## llama.cpp runtime and benchmark provenance

Metrora does not bundle or build llama.cpp. The local runtime adapter and native
Performance adapter integrate with executables supplied by the user from the
upstream `ggml-org/llama.cpp` project. The upstream project is MIT
licensed; the applicable notice is preserved in
[LICENSES/LLAMA-CPP-MIT.txt](LICENSES/LLAMA-CPP-MIT.txt).

The adapter contracts were characterized against the upstream server and
`llama-bench` documentation at the inspected master commit
`9723942adc518b43c4b95dc4dce6906903eb5e09` and release tag `b10516`
(`b95502ba9aa0eb73a2f4fc8878d7fbe6a847a0b9`). The selected executable
remains the authority for its actual build/runtime identity; Metrora retains
reported identity fields when available and does not claim that every
llama.cpp build supports every optional capability.

Source repository: `https://github.com/ggml-org/llama.cpp`

## OpenHands Agent Canvas UI primitives

Metrora Wave 001 adapts small, generic UI mechanics from
`OpenHands/OpenHands` at exact commit
`1a34e0222ee9e3c1f8c13fc16d28e69361a022ff`. The upstream root licence is MIT;
the original copyright and complete permission notice are preserved in
[`LICENSES/OPENHANDS-MIT.txt`](LICENSES/OPENHANDS-MIT.txt).

Adapted source mapping:

| Upstream path | Metrora destination | Status |
| --- | --- | --- |
| `src/components/features/sidebar/sidebar-layout.ts` | `app/renderer/ui/primitives/sidebar-layout.ts` | Modified/adapted |
| `src/components/features/sidebar/sidebar-collapsed-icon-slot.tsx` | `app/renderer/shell/sidebar/SidebarIconSlot.tsx` | Modified/adapted |
| `src/ui/typography.tsx` | `app/renderer/ui/primitives/Typography.tsx` | Modified/adapted |
| `src/ui/divider.tsx` | `app/renderer/ui/primitives/Divider.tsx` | Modified/adapted |
| `src/ui/context-menu.tsx` | `app/renderer/ui/primitives/ContextMenu.tsx` | Modified/adapted |
| `src/components/shared/modals/modal-backdrop.tsx` | `app/renderer/ui/overlays/MetroraDialog.tsx` | Modified/adapted |
| `src/components/shared/modals/modal-body.tsx` | `app/renderer/ui/overlays/MetroraModalBody.tsx` | Modified/adapted |
| `src/components/shared/buttons/modal-button.tsx` | `app/renderer/ui/primitives/MetroraModalButton.tsx` | Modified/adapted |

The `src/styles/agent-server-ui-style-scope.ts` anchor was reference-only; the
semantic token vocabulary was independently reimplemented in
`app/renderer/ui/tokens.css`. Metrora removed Tailwind, HeroUI, OpenHands
router/store/client/backend, telemetry, fonts, logos and other product assets.
The adapted primitives expose Metrora-owned contracts and can be removed or
replaced without changing Metrora facts, navigation state, ACT, Shield,
coding-engine semantics or evidence authority.

## OpenCode coding engine

Metrora Desktop bundles and invokes the official OpenCode `1.18.27` release
from upstream commit `b04697366f05419e9bd7a92f841813dd976161c9` through its
official headless server and JavaScript SDK. OpenCode remains the coding-agent
engine; Metrora does not fork, patch or redistribute a modified OpenCode core.

The upstream project is MIT licensed. Its complete permission notice is
preserved in [`LICENSES/OPENCODE-MIT.txt`](LICENSES/OPENCODE-MIT.txt).

Source repository: `https://github.com/anomalyco/opencode`

Metrora is an independent project and is not affiliated with or endorsed by
the OpenCode maintainers. The Metrora integration adds only an Electron
loopback/lifecycle boundary and one read-only `metrora_usage_snapshot` custom
tool backed by Metrora's canonical status projection.

## RFC 8785 canonicalization

`src/vendor/rfc8785-canonicalize.ts` is adapted from `erdtman/canonicalize` version `3.0.0`, exact upstream commit `63c3410a074d35950212a81fdb2bbb05607f3cd1`, originally published at `https://github.com/erdtman/canonicalize`.

The upstream work is licensed under the Apache License, Version 2.0. Metrora changed the implementation to TypeScript, added an explicit named export and unsupported-value errors, made circular-reference cleanup failure-safe, and rejects negative zero in accordance with verified RFC 8785 technical erratum 7920.

The complete Apache License 2.0 text is distributed in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).
