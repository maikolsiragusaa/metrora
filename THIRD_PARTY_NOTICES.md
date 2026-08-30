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

## RFC 8785 canonicalization

`src/vendor/rfc8785-canonicalize.ts` is adapted from `erdtman/canonicalize` version `3.0.0`, exact upstream commit `63c3410a074d35950212a81fdb2bbb05607f3cd1`, originally published at `https://github.com/erdtman/canonicalize`.

The upstream work is licensed under the Apache License, Version 2.0. Metrora changed the implementation to TypeScript, added an explicit named export and unsupported-value errors, made circular-reference cleanup failure-safe, and rejects negative zero in accordance with verified RFC 8785 technical erratum 7920.

The complete Apache License 2.0 text is distributed in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).
