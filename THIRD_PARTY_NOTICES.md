# Third-party notices

Metrora includes third-party and upstream-licensed components. Those components retain their original copyright notices and licence terms.

## Incorporated MIT component

Portions of Metrora were derived from an upstream source snapshot at commit
`146037bfd533edff85cd39f322571b2c5434fcca`.

The original copyright notice and complete MIT licence text are preserved in
[`LICENSES/UPSTREAM-MIT.txt`](LICENSES/UPSTREAM-MIT.txt).

Source repository: `https://github.com/getagentseal/codeburn`

Later provider-capacity work selectively adapts bounded MIT-licensed behavior and parsing lessons from reviewed CodeBurn revisions through `b305378e351ebb6a401e3de8f48af2565608fd3e`. Metrora keeps its own `ProviderQuotaSnapshot`, credential policy, source hierarchy, Windows discovery behavior, stale/backoff semantics, and product presentation rather than synchronizing the upstream implementation wholesale.

The DeepSeek Harness collector (`src/providers/dsh.ts`, `src/providers/dsh-session-log.ts`) is a port of that upstream snapshot's `src/providers/dsh.ts` at commit `aded4c232622b82284f22d172cecb137354e3071`, extended by Metrora to Session format version 4 (usage settled inside `assistant/message`, per-attempt replacement, fork-seed cut markers), with Metrora's own token-semantics declaration, price-authority evidence, tool normalization and cache/parse-version authorities. The upstream implementation covers session format versions 0-3 only and refuses version 4, so this port is not a wholesale synchronization.

## CodexBar capacity reference

Provider-capacity source strategies and compatibility behavior were also reviewed against `steipete/CodexBar` at commit `0a1aa53598c94003a87bcdcca4af88b0ad508421` and selectively adapted where useful. Metrora does not incorporate CodexBar as a runtime dependency and does not adopt its browser-cookie, localStorage, password-login, account-store, or application lifecycle wholesale.

The CodexBar upstream work is MIT licensed. Its original copyright notice and complete MIT licence text are preserved in [`LICENSES/CODEXBAR-MIT.txt`](LICENSES/CODEXBAR-MIT.txt).

Source repository: `https://github.com/steipete/CodexBar`

## llama.cpp runtime and benchmark provenance

Metrora does not bundle or build llama.cpp. The native Performance adapter
integrates with executables supplied by the user from the upstream
`ggml-org/llama.cpp` project. The upstream project is MIT licensed; the
applicable notice is preserved in
[LICENSES/LLAMA-CPP-MIT.txt](LICENSES/LLAMA-CPP-MIT.txt).

The adapter contract was characterized against the upstream `llama-bench`
documentation at the inspected master commit
`9723942adc518b43c4b95dc4dce6906903eb5e09` and release tag `b10516`
(`b95502ba9aa0eb73a2f4fc8878d7fbe6a847a0b9`). The selected executable
remains the authority for its actual build/runtime identity; Metrora retains
reported identity fields when available and does not claim that every
llama.cpp build supports every optional capability.

Source repository: `https://github.com/ggml-org/llama.cpp`

## OpenCode upstream runtime

Metrora packages the official `anomalyco/opencode` `v1.18.27` release binary,
source commit `b04697366f05419e9bd7a92f841813dd976161c9`, for the bounded Code
surface. The binary is served unchanged by `opencode serve`; Metrora does not
fork or copy the upstream Web UI. The upstream project is MIT licensed and its
complete notice is preserved in
[`LICENSES/OPENCODE-MIT.txt`](LICENSES/OPENCODE-MIT.txt).

Source repository: `https://github.com/anomalyco/opencode`

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
replaced without changing Metrora facts, navigation state, ACT, Shield, product
semantics or evidence authority.

## RFC 8785 canonicalization

`src/vendor/rfc8785-canonicalize.ts` is adapted from `erdtman/canonicalize` version `3.0.0`, exact upstream commit `63c3410a074d35950212a81fdb2bbb05607f3cd1`, originally published at `https://github.com/erdtman/canonicalize`.

The upstream work is licensed under the Apache License, Version 2.0. Metrora changed the implementation to TypeScript, added an explicit named export and unsupported-value errors, made circular-reference cleanup failure-safe, and rejects negative zero in accordance with verified RFC 8785 technical erratum 7920.

The complete Apache License 2.0 text is distributed in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).

## DeepSeek Harness session-log framing

`src/providers/dsh-session-log.ts` scans the zstd frame structure of DeepSeek Harness session logs. That scan is a TypeScript port of `scanZstdFrames` from the harness's own `@deepseek-ai/dsh-session-persistence-jsonl` package, because a session log is a concatenation of independent frames that a single one-shot decode would read only partially. Metrora's adaptation adds the decode budget, the torn-tail and corrupt-file reporting, the versioned-generation selection and the notice policy.

The DeepSeek Harness upstream work is MIT licensed. Its original copyright notice and complete MIT licence text are preserved in [`LICENSES/DEEPSEEK-HARNESS-MIT.txt`](LICENSES/DEEPSEEK-HARNESS-MIT.txt).

Source repository: `https://github.com/deepseek-ai/deepseek-harness`
