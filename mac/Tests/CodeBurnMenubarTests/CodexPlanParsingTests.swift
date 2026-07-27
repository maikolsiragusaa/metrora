import Foundation
import XCTest
@testable import CodeBurnMenubar

/// `plan_type` parsing and the credit-metered branch of the wham/usage decoder.
final class CodexPlanParsingTests: XCTestCase {
    private func decode(_ json: String) throws -> CodexUsage {
        try CodexSubscriptionService.decodeUsage(data: Data(json.utf8))
    }

    func testKnownTiersMapToDisplayNames() {
        let expected: [String: String] = [
            "guest": "Guest", "free": "Free", "go": "Go", "plus": "Plus", "pro": "Pro",
            "prolite": "Pro Lite", "pro_lite": "Pro Lite", "pro-lite": "Pro Lite",
            "free_workspace": "Free Workspace", "team": "Team", "business": "Business",
            "education": "Education", "quorum": "Quorum", "k12": "K-12",
            "enterprise": "Enterprise", "edu": "Edu",
        ]
        for (raw, display) in expected {
            XCTAssertEqual(CodexUsage.planType(from: raw).displayName, display, "plan_type: \(raw)")
        }
    }

    func testTierMatchingIsCaseInsensitive() {
        XCTAssertEqual(CodexUsage.planType(from: "pLuS"), .plus)
        XCTAssertEqual(CodexUsage.planType(from: "ENTERPRISE"), .enterprise)
    }

    func testCreditBasedPricingCompositesNormalize() {
        XCTAssertEqual(CodexUsage.planType(from: "enterprise_cbp_usage_based"), .enterprise)
        XCTAssertEqual(CodexUsage.planType(from: "self_serve_business_usage_based"), .business)
        XCTAssertEqual(CodexUsage.planType(from: "business_cbp"), .business)
    }

    func testHyphenSeparatedCompositesNormalizeToo() {
        XCTAssertEqual(CodexUsage.planType(from: "enterprise-cbp-usage-based"), .enterprise)
        XCTAssertEqual(CodexUsage.planType(from: "self-serve-business-usage-based"), .business)
        XCTAssertEqual(CodexUsage.planType(from: "business-cbp"), .business)
    }

    func testUnknownTierNormalizesAndTitleCasesLikeTheDesktopDecoder() {
        XCTAssertEqual(CodexUsage.planType(from: "some_future_tier_usage_based"),
                       .unknown("some_future_tier"))
        XCTAssertEqual(CodexUsage.planType(from: "some_future_tier_usage_based").displayName,
                       "Some Future Tier")
        XCTAssertEqual(CodexUsage.planType(from: nil), .unknown(""))
        XCTAssertEqual(CodexUsage.planType(from: nil).displayName, "Subscription")
    }

    /// Captured from a live ChatGPT Enterprise workspace (identifiers replaced).
    private let enterprisePayload = #"""
    {
      "plan_type": "business",
      "rate_limit": null,
      "code_review_rate_limit": null,
      "additional_rate_limits": null,
      "credits": {
        "has_credits": false, "unlimited": false, "overage_limit_reached": false,
        "balance": null, "approx_local_messages": null, "approx_cloud_messages": null
      },
      "spend_control": {
        "reached": false,
        "individual_limit": {
          "source": "workspace_spend_controls",
          "limit": "10000",
          "used": "3028.9909675121307",
          "remaining": "6971.009032487869",
          "used_percent": 30,
          "remaining_percent": 70,
          "reset_after_seconds": 441896,
          "reset_at": 1785542400
        }
      },
      "rate_limit_reset_credits": {"available_count": 0, "applicable_available_count": 0}
    }
    """#

    func testEnterprisePayloadDecodesTheSpendControlLimit() throws {
        let usage = try decode(enterprisePayload)
        XCTAssertNil(usage.primary)
        XCTAssertNil(usage.secondary)
        XCTAssertTrue(usage.additionalLimits.isEmpty)

        let credits = try XCTUnwrap(usage.creditLimit)
        XCTAssertEqual(credits.limit, 10_000)
        XCTAssertEqual(credits.used, 3028.9909675121307, accuracy: 0.0001)
        XCTAssertEqual(credits.usedPercent, 30)
        XCTAssertEqual(credits.resetsAt, Date(timeIntervalSince1970: 1_785_542_400))
        XCTAssertFalse(credits.reached)
        // July 2026, not the payload's `reset_after_seconds`.
        XCTAssertEqual(try XCTUnwrap(credits.windowSeconds), 31 * 86_400)

        XCTAssertEqual(usage.plan, .business)
        XCTAssertNil(usage.creditsBalance)
        XCTAssertFalse(usage.hasCredits)
        XCTAssertFalse(usage.creditsUnlimited)
    }

    func testSpendControlIsReadAtEveryObservedPosition() throws {
        let bodies = [
            #"{"spend_control": {"individual_limit": {"limit": 10000, "used_percent": 25}}}"#,
            #"{"spend_control": {"individualLimit": {"limit": 10000, "usedPercent": 25}}}"#,
            #"{"individual_limit": {"limit": 10000, "used_percent": 25}}"#,
            #"{"rate_limit": {"individual_limit": {"limit": 10000, "used_percent": 25}}}"#,
        ]
        for body in bodies {
            let credits = try XCTUnwrap(decode(body).creditLimit, body)
            XCTAssertEqual(credits.usedPercent, 25, body)
            XCTAssertEqual(credits.used, 2500, body)
        }
    }

    func testPercentFallsBackThroughRemainingPercentThenRawRatio() throws {
        let fromRemaining = try XCTUnwrap(
            decode(#"{"spend_control": {"individual_limit": {"limit": 10000, "remaining_percent": 70}}}"#).creditLimit)
        XCTAssertEqual(fromRemaining.usedPercent, 30, accuracy: 0.0001)

        let fromRatio = try XCTUnwrap(
            decode(#"{"spend_control": {"individual_limit": {"limit": 400, "used": 100}}}"#).creditLimit)
        XCTAssertEqual(fromRatio.usedPercent, 25, accuracy: 0.0001)
    }

    func testUnusableSpendControlYieldsNoRow() throws {
        let bodies = [
            #"{"spend_control": {"individual_limit": {"limit": 0, "used": 5}}}"#,
            #"{"spend_control": {"individual_limit": {"limit": null}}}"#,
            #"{"spend_control": {"individual_limit": {"used_percent": 40}}}"#,
            #"{"spend_control": {"individual_limit": null}}"#,
            #"{"spend_control": null}"#,
            "{}",
        ]
        for body in bodies {
            XCTAssertNil(try decode(body).creditLimit, body)
        }
    }

    func testAllowanceWithoutAnyUsageSignalYieldsNoRow() throws {
        let body = #"{"spend_control": {"individual_limit": {"limit": 10000, "reset_at": 1785542400}}}"#
        XCTAssertNil(try decode(body).creditLimit)
    }

    func testBlankNumericStringIsAbsentNotZero() throws {
        let credits = try XCTUnwrap(decode(#"""
        {"spend_control": {"individual_limit": {"limit": "10000", "used": "  ", "used_percent": 30}}}
        """#).creditLimit)
        XCTAssertEqual(credits.used, 3000, accuracy: 0.001)
        XCTAssertNil(try decode(#"{"spend_control": {"individual_limit": {"limit": ""}}}"#).creditLimit)
    }

    func testOverageKeepsCountsTruthfulWhileClampingPercent() throws {
        let credits = try XCTUnwrap(decode(#"""
        {"spend_control": {"individual_limit": {"limit": 10000, "used": 12000, "used_percent": 120}}}
        """#).creditLimit)
        XCTAssertEqual(credits.used, 12000, accuracy: 0.001)
        XCTAssertEqual(credits.usedPercent, 100)
    }

    func testMonthWindowIsTimezoneIndependent() throws {
        // 2026-03-01Z reads as 28 days in UTC but 31 through a local calendar.
        let body = #"{"spend_control": {"individual_limit": {"limit": 100, "used_percent": 10, "reset_at": 1772323200}}}"#
        XCTAssertEqual(try XCTUnwrap(decode(body).creditLimit?.windowSeconds), 28 * 86_400)
    }

    func testOutOfRangeNumbersDoNotTrap() throws {
        // `Int(_:)` on 1e100 traps, and a trap is not a catchable error.
        for body in [
            #"{"spend_control": {"individual_limit": {"limit": 100, "used_percent": 10, "reset_at": 1e100}}}"#,
            #"{"spend_control": {"individual_limit": {"limit": "Infinity", "used_percent": 10}}}"#,
            #"{"spend_control": {"individual_limit": {"limit": 100, "used_percent": "NaN"}}}"#,
        ] {
            _ = try? decode(body)
        }
        let huge = #"{"spend_control": {"individual_limit": {"limit": 100, "used_percent": 10, "reset_at": "1e100"}}}"#
        XCTAssertNil(try XCTUnwrap(decode(huge).creditLimit).resetsAt)
    }

    func testPercentOnlyOverageKeepsTheImpliedCount() throws {
        let body = #"{"spend_control": {"individual_limit": {"limit": 10000, "used_percent": 120}}}"#
        let credits = try XCTUnwrap(decode(body).creditLimit)
        XCTAssertEqual(credits.used, 12000, accuracy: 0.001)
        XCTAssertEqual(credits.usedPercent, 100)
        XCTAssertEqual(credits.displayLabel, "Monthly usage limit · 12,000 / 10,000 credits")
    }

    func testOneMalformedAdditionalLimitDoesNotDiscardTheRest() throws {
        let body = #"""
        {"additional_rate_limits": [
          null,
          {"limit_name": "Spark", "rate_limit": {"primary_window": {"used_percent": 40, "limit_window_seconds": 18000}}}
        ]}
        """#
        XCTAssertEqual(try decode(body).additionalLimits.map(\.name), ["Spark"])
    }

    func testReachedSpendControlIsCarriedThrough() throws {
        let credits = try XCTUnwrap(decode(#"""
        {"spend_control": {"reached": true, "individual_limit": {"limit": 10000, "used_percent": 100}}}
        """#).creditLimit)
        XCTAssertTrue(credits.reached)
        XCTAssertEqual(credits.usedPercent, 100)
    }

    func testCreditFlagsAndMixedNumberEncodings() throws {
        let usage = try decode(#"""
        {"credits": {"has_credits": true, "unlimited": true, "balance": "3410.40"}}
        """#)
        XCTAssertTrue(usage.hasCredits)
        XCTAssertTrue(usage.creditsUnlimited)
        XCTAssertEqual(try XCTUnwrap(usage.creditsBalance), 3410.40, accuracy: 0.0001)
    }

    func testRateWindowsStillDecodeAlongsideASpendControl() throws {
        let usage = try decode(#"""
        {
          "plan_type": "plus",
          "rate_limit": {
            "primary_window": {"used_percent": 20, "reset_at": 1800000000, "limit_window_seconds": 18000}
          },
          "spend_control": {"individual_limit": {"limit": 10000, "used_percent": 30}}
        }
        """#)
        XCTAssertEqual(usage.primary?.usedPercent, 20)
        XCTAssertEqual(usage.primary?.windowLabel, "5-hour")
        XCTAssertEqual(usage.creditLimit?.usedPercent, 30)
    }

    func testOnlyAZeroCountSkipsTheCompanionRequest() {
        let zero = #"{"rate_limit_reset_credits": {"available_count": 0}}"#
        let some = #"{"rate_limit_reset_credits": {"available_count": 3}}"#
        XCTAssertEqual(CodexSubscriptionService.inlineResetCreditsShortcut(data: Data(zero.utf8))?.availableCount, 0)
        XCTAssertNil(CodexSubscriptionService.inlineResetCreditsShortcut(data: Data(some.utf8)))
        XCTAssertNil(CodexSubscriptionService.inlineResetCreditsShortcut(data: Data("{}".utf8)))
        XCTAssertEqual(CodexSubscriptionService.inlineResetCredits(data: Data(some.utf8))?.availableCount, 3)
    }

    func testInlineResetCreditsParseFromTheUsagePayload() {
        let inline = CodexSubscriptionService.inlineResetCredits(data: Data(enterprisePayload.utf8))
        XCTAssertEqual(inline?.availableCount, 0)
        XCTAssertNil(inline?.nextExpiresAt)
    }

    func testInlineResetCreditsAbsentSignalsFallback() {
        XCTAssertNil(CodexSubscriptionService.inlineResetCredits(data: Data("{}".utf8)))
        XCTAssertNil(CodexSubscriptionService.inlineResetCredits(data: Data("not json".utf8)))
        XCTAssertNil(CodexSubscriptionService.inlineResetCredits(
            data: Data(#"{"rate_limit_reset_credits": {}}"#.utf8)))
    }
}
