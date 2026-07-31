# Upstream provenance

Qovrion started from the CodeBurn 0.9.19 source tree.

- Upstream repository: `https://github.com/getagentseal/codeburn`
- Imported baseline: `146037bfd533edff85cd39f322571b2c5434fcca`
- License: MIT
- Upstream Semgrep guard on Ubuntu: passed
- Upstream CLI build on Node.js 22.13.0: passed
- Full Ubuntu Vitest audit: failure

The full Vitest result is recorded for transparency. At this baseline,
CodeBurn's blocking upstream GitHub workflow runs the Semgrep guard but
does not run the complete platform-sensitive Vitest suite.

Qovrion has an independent product identity and development history.
Future upstream fixes may be reviewed and selectively integrated, with
their provenance recorded in this file or in the corresponding commit.
