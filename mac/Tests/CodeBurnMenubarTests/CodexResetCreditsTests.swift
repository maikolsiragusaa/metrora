import Foundation
import XCTest
@testable import CodeBurnMenubar

final class CodexResetCreditsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func parse(_ json: String) -> CodexUsage.ResetCredits? {
        CodexSubscriptionService.parseResetCredits(data: Data(json.utf8), now: now)
    }

    func testFullPayloadPicksSoonestAvailableExpiry() {
        let result = parse(#"""
        {
          "credits": [
            {"id": "c1", "reset_type": "weekly", "status": "available",
             "granted_at": "2026-07-01T00:00:00Z", "expires_at": "2027-01-25T12:00:00Z"},
            {"id": "c2", "reset_type": "weekly", "status": "available",
             "granted_at": "2026-07-02T00:00:00Z", "expires_at": "2027-01-16T08:30:00.500Z"},
            {"id": "c3", "reset_type": "weekly", "status": "redeemed",
             "granted_at": "2026-06-01T00:00:00Z", "expires_at": "2027-01-10T00:00:00Z",
             "redeemed_at": "2026-06-05T00:00:00Z"}
          ],
          "available_count": 2
        }
        """#)
        XCTAssertEqual(result?.availableCount, 2)
        // c2 (fractional-seconds timestamp) is soonest among *available* credits;
        // redeemed c3 must not win despite expiring earlier.
        XCTAssertEqual(
            result?.nextExpiresAt,
            ISO8601DateFormatter().date(from: "2027-01-16T08:30:00Z")?.addingTimeInterval(0.5)
        )
    }

    func testMissingExpiryStillReportsCount() {
        let result = parse(#"{"credits": [{"id": "c1", "status": "available"}], "available_count": 1}"#)
        XCTAssertEqual(result?.availableCount, 1)
        XCTAssertNil(result?.nextExpiresAt)
    }

    func testUnknownStatusIsIgnoredForExpiryButCountIsServerAuthoritative() {
        let result = parse(#"""
        {
          "credits": [{"id": "c1", "status": "pending_grant", "expires_at": "2027-01-16T08:30:00Z"}],
          "available_count": 1
        }
        """#)
        XCTAssertEqual(result?.availableCount, 1)
        XCTAssertNil(result?.nextExpiresAt)
    }

    func testAlreadyExpiredCreditDoesNotSurfaceAsNextExpiry() {
        let result = parse(#"""
        {
          "credits": [{"id": "c1", "status": "available", "expires_at": "2020-01-01T00:00:00Z"}],
          "available_count": 1
        }
        """#)
        XCTAssertEqual(result?.availableCount, 1)
        XCTAssertNil(result?.nextExpiresAt)
    }

    func testEmptyCreditsZeroCount() {
        let result = parse(#"{"credits": [], "available_count": 0}"#)
        XCTAssertEqual(result?.availableCount, 0)
        XCTAssertNil(result?.nextExpiresAt)
    }

    func testMalformedDocumentReturnsNil() {
        XCTAssertNil(parse("not json"))
        XCTAssertNil(parse(#"{"credits": "wrong-shape"}"#))
        XCTAssertNil(parse(#"{"credits": []}"#))
        XCTAssertNil(parse(#"{"available_count": -1, "credits": []}"#))
    }
}
