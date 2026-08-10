# Third-party notices

Metrora includes third-party and upstream-licensed components. Those components retain their original copyright notices and licence terms.

## Incorporated MIT component

Portions of Metrora were derived from an upstream source snapshot at commit
`146037bfd533edff85cd39f322571b2c5434fcca`.

The original copyright notice and complete MIT licence text are preserved in
[`LICENSES/UPSTREAM-MIT.txt`](LICENSES/UPSTREAM-MIT.txt).

Source repository: `https://github.com/getagentseal/codeburn`

## RFC 8785 canonicalization

`src/vendor/rfc8785-canonicalize.ts` is adapted from `erdtman/canonicalize` version `3.0.0`, exact upstream commit `63c3410a074d35950212a81fdb2bbb05607f3cd1`, originally published at `https://github.com/erdtman/canonicalize`.

The upstream work is licensed under the Apache License, Version 2.0. Metrora changed the implementation to TypeScript, added an explicit named export and unsupported-value errors, made circular-reference cleanup failure-safe, and rejects negative zero in accordance with verified RFC 8785 technical erratum 7920.

The complete Apache License 2.0 text is distributed in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).
