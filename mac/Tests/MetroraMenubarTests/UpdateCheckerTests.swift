import Testing
@testable import MetroraMenubar

@Suite("UpdateChecker")
struct UpdateCheckerTests {
    @Test("selects newest mac release with zip and checksum")
    func selectsNewestMacReleaseWithChecksum() {
        let releases = [
            GitHubRelease(
                tag_name: "v0.9.9",
                assets: [GitHubAsset(name: "metrora-0.9.9.tgz", browser_download_url: "https://example.test/cli")]
            ),
            GitHubRelease(
                tag_name: "mac-v0.9.8",
                assets: [
                    GitHubAsset(name: "MetroraMenubar-v0.9.8.zip", browser_download_url: "https://example.test/app"),
                    GitHubAsset(name: "MetroraMenubar-v0.9.8.zip.sha256", browser_download_url: "https://example.test/app.sha256"),
                ]
            ),
        ]

        let resolved = UpdateChecker.resolveLatestMenubarRelease(in: releases)

        #expect(resolved?.release.tag_name == "mac-v0.9.8")
        #expect(resolved?.asset.name == "MetroraMenubar-v0.9.8.zip")
    }

    @Test("ignores mac release missing checksum")
    func ignoresMacReleaseMissingChecksum() {
        let releases = [
            GitHubRelease(
                tag_name: "mac-v0.9.8",
                assets: [GitHubAsset(name: "MetroraMenubar-v0.9.8.zip", browser_download_url: "https://example.test/app")]
            ),
        ]

        #expect(UpdateChecker.resolveLatestMenubarRelease(in: releases) == nil)
    }

    @Test("flags CLI older than the menubar-update fix as too old")
    func flagsCliBelowMinimumAsTooOld() {
        #expect(UpdateChecker.isCliTooOld(installed: "0.9.8"))
        #expect(UpdateChecker.isCliTooOld(installed: "v0.9.8"))
        #expect(UpdateChecker.isCliTooOld(installed: "0.8.12"))
    }

    @Test("accepts CLI at or above the menubar-update fix version")
    func acceptsCliAtOrAboveMinimum() {
        #expect(!UpdateChecker.isCliTooOld(installed: "0.9.9"))
        #expect(!UpdateChecker.isCliTooOld(installed: "0.9.10"))
        #expect(!UpdateChecker.isCliTooOld(installed: "0.9.14"))
        #expect(!UpdateChecker.isCliTooOld(installed: "1.0.0"))
    }

    @Test("does not flag when the CLI version is unknown")
    func ignoresUnknownCliVersion() {
        #expect(!UpdateChecker.isCliTooOld(installed: nil))
        #expect(!UpdateChecker.isCliTooOld(installed: ""))
    }
}

@Suite("Update failure presentation")
@MainActor
struct UpdateFailurePresentationTests {
    @Test("identifies an automatic update check failure")
    func updateCheckFailure() {
        let checker = UpdateChecker()
        checker.updateFailureStage = .check
        checker.updateError = "GitHub returned HTTP 403."

        #expect(checker.updateBadgeLabel == "Update Check Failed")
        #expect(checker.updateHelpText.contains("could not check GitHub for updates"))
        #expect(checker.updateHelpText.contains("GitHub returned HTTP 403."))
        #expect(checker.updateHelpText.contains("retry the update check"))
    }

    @Test("distinguishes CLI update failures")
    func cliUpdateFailure() {
        let checker = UpdateChecker()
        checker.updateFailureStage = .cliUpdate
        checker.updateError = "npm exited with status 1."

        #expect(checker.updateBadgeLabel == "CLI Update Failed")
        #expect(checker.updateHelpText.contains("could not update the CLI"))
        #expect(checker.updateHelpText.contains("npm exited with status 1."))
    }

    @Test("distinguishes menubar update failures")
    func menubarUpdateFailure() {
        let checker = UpdateChecker()
        checker.updateFailureStage = .menubarUpdate
        checker.updateError = "Checksum mismatch."

        #expect(checker.updateBadgeLabel == "Menubar Update Failed")
        #expect(checker.updateHelpText.contains("could not update the menubar app"))
        #expect(checker.updateHelpText.contains("Checksum mismatch."))
    }
}


// MARK: - one-click full update: package-manager resolution

@Suite("cliUpdateInvocation")
struct CliUpdateInvocationTests {
    @Test("homebrew path resolves brew upgrade")
    func homebrewPath() {
        let argv = UpdateChecker.cliUpdateInvocation(cliPath: "/opt/homebrew/bin/metrora", fileExists: { $0 == "/opt/homebrew/bin/brew" })
        #expect(argv == ["/opt/homebrew/bin/brew", "upgrade", "metrora"])
    }

    @Test("Cellar path resolves brew upgrade")
    func cellarPath() {
        let argv = UpdateChecker.cliUpdateInvocation(cliPath: "/usr/local/Cellar/metrora/0.9.18/bin/metrora", fileExists: { $0 == "/usr/local/bin/brew" })
        #expect(argv == ["/usr/local/bin/brew", "upgrade", "metrora"])
    }

    @Test("sibling npm wins over global npm so the update lands in the same toolchain")
    func siblingNpmWins() {
        let exists: (String) -> Bool = { $0 == "/Users/u/.nvm/versions/node/v22.1.0/bin/npm" || $0 == "/opt/homebrew/bin/npm" }
        let argv = UpdateChecker.cliUpdateInvocation(cliPath: "/Users/u/.nvm/versions/node/v22.1.0/bin/metrora", fileExists: exists)
        #expect(argv == ["/Users/u/.nvm/versions/node/v22.1.0/bin/npm", "install", "-g", "metrora@latest", "--force"])
    }

    @Test("falls back to well-known npm locations")
    func fallbackNpm() {
        let argv = UpdateChecker.cliUpdateInvocation(cliPath: "/some/odd/place/metrora", fileExists: { $0 == "/usr/local/bin/npm" })
        #expect(argv == ["/usr/local/bin/npm", "install", "-g", "metrora@latest", "--force"])
    }

    @Test("no known manager returns nil instead of guessing")
    func unknownManager() {
        #expect(UpdateChecker.cliUpdateInvocation(cliPath: "/some/odd/place/metrora", fileExists: { _ in false }) == nil)
    }

    @Test("homebrew CLI without a findable brew never falls through to npm")
    func brewMissingStaysNil() {
        // Falling through to npm --force would create a second, conflicting install.
        #expect(UpdateChecker.cliUpdateInvocation(cliPath: "/opt/homebrew/bin/metrora", fileExists: { $0.hasSuffix("/npm") }) == nil)
    }
}
