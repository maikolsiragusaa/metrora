# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities via [GitHub's private vulnerability reporting](https://github.com/getagentseal/codeburn/security/advisories/new).

Do not open a public issue for security vulnerabilities.

## Scope

Security reports are welcome for:

- The CLI (`src/`)
- The menubar installer (`src/menubar-installer.ts`)
- The macOS menubar app (`mac/`)
- The desktop app (`desktop/`)
- CI/CD workflows (`.github/workflows/`)

## Release Integrity

Menubar release assets include a `.sha256` checksum file. The installer verifies the checksum before extracting and launching the downloaded bundle.
