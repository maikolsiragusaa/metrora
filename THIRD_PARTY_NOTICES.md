# Third-party notices

Metrora includes third-party and upstream-licensed components. Those components retain their original copyright notices and licence terms.

## CodeBurn

Portions of Metrora were originally derived from CodeBurn 0.9.19 at commit `146037bfd533edff85cd39f322571b2c5434fcca`.

CodeBurn is Copyright (c) 2026 AgentSeal and is licensed under the MIT License. The original notice and complete licence text are preserved in [`LICENSES/CodeBurn-MIT.txt`](LICENSES/CodeBurn-MIT.txt).

Original project: `https://github.com/getagentseal/codeburn`

## RFC 8785 canonicalization

`src/vendor/rfc8785-canonicalize.ts` is adapted from `erdtman/canonicalize`, originally published at `https://github.com/erdtman/canonicalize`.

The upstream work is licensed under the Apache License, Version 2.0. Metrora changed the implementation to TypeScript, added explicit named exports and stricter unsupported-value errors, and formatted it for the Metrora codebase.

The complete Apache License 2.0 text is distributed in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).
