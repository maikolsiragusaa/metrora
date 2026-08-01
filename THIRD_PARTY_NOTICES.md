# Third-party notices

## CodeBurn

Metrora was initially bootstrapped from CodeBurn 0.9.19 at commit
`146037bfd533edff85cd39f322571b2c5434fcca`.

CodeBurn is Copyright (c) 2026 AgentSeal and is distributed under the
MIT License. The original MIT license and copyright notice are retained
in `LICENSE`.

Original project: `https://github.com/getagentseal/codeburn`

## RFC 8785 canonicalization

`src/vendor/rfc8785-canonicalize.ts` is adapted from `erdtman/canonicalize`,
originally published at `https://github.com/erdtman/canonicalize`.

The upstream work is licensed under the Apache License, Version 2.0.
Metrora changed the implementation to TypeScript, added explicit named exports
and stricter unsupported-value errors, and formatted it for the Metrora codebase.

The complete Apache License 2.0 text is distributed in
`LICENSES/Apache-2.0.txt`.
