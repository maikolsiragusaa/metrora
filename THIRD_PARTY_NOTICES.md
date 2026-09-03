# Third-party notices

Metrora includes third-party and upstream-licensed components. Those components retain their original copyright notices and licence terms.

## DeepSeek Harness OSS runtime substrate

The Desktop Harness runtime composes the package-level DeepSeek Harness OSS
substrate from `deepseek-ai/deepseek-harness` at exact commit
`49a606bc5b5934603f22a26957a07dc799ab0291`, release `0.1.2-alpha.5`.
The selected upstream work is MIT licensed by DeepSeek; the complete original
notice and licence text are preserved in
[`LICENSES/DEEPSEEK-HARNESS-MIT.txt`](LICENSES/DEEPSEEK-HARNESS-MIT.txt).
Metrora retains ownership of product context, canonical facts, Shield/ACT
authority, evidence projections, provider selection and user-facing UX; the
upstream packages provide the durable session, agent-loop, tool registry and
bounded subagent substrate.

Source repository: `https://github.com/deepseek-ai/deepseek-harness`

## DeepSeek Harness web UI reference

The Metrora Harness web surface substantially adapts the pinned DeepSeek
Harness client UI snapshot at commit
`76fda729799fe9b3848dbe2c211d4b231032b81e`. Adapted patterns and CSS include
the session rail, model/variant picker, composer card, permission/mode control,
turn/process disclosure, reasoning row and tool summary rows. The runtime
authority remains the separate pinned `49a606bc5b5934603f22a26957a07dc799ab0291`
substrate above; the newer UI snapshot is not used to upgrade runtime packages.

Source files/packages adapted into Metrora's local Harness surface:

| DeepSeek Harness source | Metrora destination |
| --- | --- |
| `packages/client/ui-sidebar/src/client/SidebarRoot.module.css` | `app/renderer/styles/harness-v3.css` session rail |
| `packages/client/ui-model-selection/src/client/ModelSelect.tsx` and `.module.css` | `app/renderer/sections/Harness.tsx` and picker styles |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css` and `PermissionSelect.module.css` | `app/renderer/sections/Harness.tsx` composer and mode picker |
| `packages/client/ui-chat/src/client/chat/TurnProcessNodeView.module.css`, `ReasoningRow.module.css` and `MessageItem.module.css` | `app/renderer/styles/harness-v3.css` process, reasoning and message styles |

The source repository is MIT licensed. The complete original notice and
license text are preserved in
[`LICENSES/DEEPSEEK-HARNESS-MIT.txt`](LICENSES/DEEPSEEK-HARNESS-MIT.txt).

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
Harness semantics or evidence authority.

## RFC 8785 canonicalization

`src/vendor/rfc8785-canonicalize.ts` is adapted from `erdtman/canonicalize` version `3.0.0`, exact upstream commit `63c3410a074d35950212a81fdb2bbb05607f3cd1`, originally published at `https://github.com/erdtman/canonicalize`.

The upstream work is licensed under the Apache License, Version 2.0. Metrora changed the implementation to TypeScript, added an explicit named export and unsupported-value errors, made circular-reference cleanup failure-safe, and rejects negative zero in accordance with verified RFC 8785 technical erratum 7920.

The complete Apache License 2.0 text is distributed in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).
