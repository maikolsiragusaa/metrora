# Windows GitHub pre-release acceptance v1

## Status

Active acceptance contract for the first unsigned Metrora Windows GitHub pre-release.

No candidate is accepted or published merely because this contract exists. The final candidate must be built from an exact reviewed `main` commit, pass automated and physical acceptance, and receive an explicit publication decision.

This contract does not govern Microsoft Store packaging, signing or certification.

## Channel boundary

The GitHub channel is intended for technical evaluators who deliberately choose an unsigned Windows candidate.

It may provide:

- a verified portable ZIP;
- an explicitly unsigned NSIS installer;
- SHA-256 checksums;
- release, payload and format manifests;
- a sanitized physical-acceptance report;
- release notes and known limitations.

It must not be described as a stable release, a signed package, a Microsoft-certified package or an automatic update channel.

## Source and build authority

The candidate authority is:

1. one reviewed public `main` commit;
2. one explicit `Metrora Windows Candidate` workflow dispatch for that commit with classification `unsigned-release-candidate`;
3. the complete downloaded workflow artifact ZIP;
4. the manifests, inventories and checksums contained in that artifact;
5. independent post-download verification from the same workflow run.

A pull-request merge ref, locally rebuilt candidate, manually reconstructed directory or artifact from another commit is not release authority.

The public product version and Windows file version come from the repository version authority. They may not be patched after the product build.

## Automated gates

Before physical acceptance begins, the exact candidate commit must pass the applicable repository checks, including:

- version authority;
- core and desktop tests;
- architecture and security boundaries;
- public identity checks;
- Windows payload build and format derivation;
- clean install and removal;
- migration, reinstall, rollback and re-upgrade;
- controlled interruption and recovery;
- independent verification of the downloaded candidate;
- physical-acceptance report and PowerShell runtime guards.

A skipped required job, stale run, failed job or candidate from another commit is a stop condition.

## Physical acceptance report v2

Current candidates use `metrora.windows-physical-acceptance-report` version 2.

Version 2 records both:

- the exact candidate source commit, public product version and Windows file version;
- the exact historical migration baseline commit, public product version and Windows file version.

The current migration baseline is the accepted Metrora `0.9.19` Windows source at commit:

```text
80c3a5a1a116a0bc2fd5352b9fee2afc58207f15
```

The active candidate has public product version `1.0.0-rc.7` and Windows file version `1.0.0.7`. Migration lifecycle labels use the installed Windows file versions because that is the executable identity verified by the installer harness.

A PASS therefore requires:

```text
installed-0.9.19
upgraded-1.0.0.7
reinstalled-1.0.0.7
uninstalled-for-rollback
rolled-back-0.9.19
re-upgraded-1.0.0.7
uninstalled
```

Historical report version 1 remains valid for the bounded `0.9.18` to `0.9.19` acceptance it originally described. Version 2 does not reinterpret or overwrite that evidence.

## Physical execution

Use a clean checkout at the exact candidate commit and the intact downloaded candidate ZIP.

The guided entry point is:

```text
AVVIA-TEST-FISICO-METRORA.cmd
```

The procedure keeps the established two-profile safety split:

1. the existing primary Windows profile performs portable preservation and reopen checks only;
2. a separate local Windows user performs clean install, uninstall, migration, rollback and re-upgrade tests.

The final report must verify against the exact candidate commit and must not contain usernames, local paths, prompts, responses, Workspace identifiers, keys, receipts or evidence contents.

A FAIL remains evidence. Do not delete user-owned state, alter the report or rebuild the candidate to manufacture a PASS.

## Release-asset boundary

After physical PASS, release assets must be derived only from the accepted downloaded candidate. Product binaries must not be rebuilt or modified.

Published assets must remain traceable to:

- source commit;
- public product version and Windows file version;
- workflow run and attempt;
- release manifest digest;
- format manifest digest;
- physical-acceptance report digest;
- final release-asset SHA-256 values.

The portable and installer signature status must be stated as unsigned. SmartScreen guidance must explain the warning without telling users to disable platform security globally.

## Publication gate

Publication requires an explicit stop/go after all of the following are fixed and reviewed:

- accepted source commit;
- accepted workflow run;
- accepted artifact digest;
- physical report PASS and digest;
- final asset names and checksums;
- release notes and known limitations;
- rollback and withdrawal procedure;
- truthful website and GitHub channel wording.

Creating this contract, passing CI or completing physical acceptance does not publish a release automatically.

## Microsoft independence

Partner Center verification may proceed separately. A later Microsoft Store package uses exact platform-issued identity and Store-specific acceptance.

Microsoft delay does not block preparation or publication of an explicitly unsigned GitHub pre-release, and GitHub publication does not imply Store acceptance or signing.
