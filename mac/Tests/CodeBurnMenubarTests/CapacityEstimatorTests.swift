import Foundation
import Testing
@testable import CodeBurnMenubar

private let now = Date(timeIntervalSince1970: 1_734_000_000)

private func snap(_ percent: Double, _ tokens: Double, ageDays: Double = 0) -> CapacitySnapshot {
    CapacitySnapshot(
        percent: percent,
        effectiveTokens: tokens,
        capturedAt: now.addingTimeInterval(-ageDays * 86400)
    )
}

@Suite("CapacityEstimator -- gating")
struct CapacityEstimatorGatingTests {
    @Test("returns nil with no snapshots")
    func emptyReturnsNil() {
        #expect(CapacityEstimator.estimate([], asOf: now) == nil)
    }

    @Test("returns nil with fewer than 5 snapshots")
    func tooFewReturnsNil() {
        let snaps = (1...4).map { snap(Double($0 * 10), Double($0) * 100_000) }
        #expect(CapacityEstimator.estimate(snaps, asOf: now) == nil)
    }

    @Test("returns nil when percent range is below 15 points")
    func tooNarrowReturnsNil() {
        let snaps = [
            snap(40, 4_000_000),
            snap(42, 4_200_000),
            snap(44, 4_400_000),
            snap(46, 4_600_000),
            snap(48, 4_800_000),
            snap(50, 5_000_000),
        ]
        #expect(CapacityEstimator.estimate(snaps, asOf: now) == nil)
    }
}

@Suite("CapacityEstimator -- recovery")
struct CapacityEstimatorRecoveryTests {
    @Test("recovers capacity from 10 noise-free snapshots within 0.5%")
    func recoverFromCleanData() {
        let trueCapacity: Double = 10_000_000
        let percents = [5.0, 12, 20, 28, 35, 47, 55, 68, 80, 92]
        let snaps = percents.map { p in snap(p, p / 100 * trueCapacity) }
        let est = CapacityEstimator.estimate(snaps, asOf: now)
        #expect(est != nil)
        #expect(est!.capacity > trueCapacity * 0.995)
        #expect(est!.capacity < trueCapacity * 1.005)
        // 10 perfect samples is below the solid sample threshold (15) but easily medium.
        #expect(est!.confidence == .medium || est!.confidence == .solid)
    }

    @Test("recovers capacity within 5% from 30 noisy snapshots")
    func recoverFromNoisyData() {
        let trueCapacity: Double = 8_000_000
        var rng = LinearCongruentialGenerator(seed: 42)
        let snaps: [CapacitySnapshot] = (0..<30).map { i in
            let p = 5.0 + Double(i) * 3.0   // 5..92, spanning enough
            let noise = (rng.nextDouble() - 0.5) * 0.10  // ±5%
            let tokens = (p / 100) * trueCapacity * (1 + noise)
            return snap(p, tokens)
        }
        let est = CapacityEstimator.estimate(snaps, asOf: now)
        #expect(est != nil)
        let ratio = est!.capacity / trueCapacity
        #expect(ratio > 0.95 && ratio < 1.05)
        #expect(est!.confidence == .solid || est!.confidence == .medium)
    }
}

@Suite("CapacityEstimator -- confidence tiers")
struct CapacityEstimatorConfidenceTests {
    @Test("six clean snapshots span sufficient range -> at least medium")
    func sixCleanSnapshotsMedium() {
        let trueCapacity: Double = 5_000_000
        let percents = [5.0, 18, 32, 51, 70, 88]
        let snaps = percents.map { p in snap(p, p / 100 * trueCapacity) }
        let est = CapacityEstimator.estimate(snaps, asOf: now)
        #expect(est != nil)
        #expect(est!.confidence == .medium || est!.confidence == .solid)
    }

    @Test("noisy small-sample data falls to low confidence")
    func noisySmallSampleLow() {
        let trueCapacity: Double = 5_000_000
        var rng = LinearCongruentialGenerator(seed: 7)
        let percents = [5.0, 22, 40, 60, 80, 95]
        let snaps: [CapacitySnapshot] = percents.map { p in
            let noise = (rng.nextDouble() - 0.5) * 1.6  // ±80% noise -> drops R^2 below medium gate
            return snap(p, p / 100 * trueCapacity * (1 + noise))
        }
        let est = CapacityEstimator.estimate(snaps, asOf: now)
        #expect(est != nil)
        #expect(est!.confidence == .low)
    }
}

@Suite("CapacityEstimator -- recency weighting")
struct CapacityEstimatorRecencyTests {
    @Test("recent snapshots dominate over old ones with different capacity")
    func recencyShiftsEstimate() {
        // Old data: capacity = 5M (45 days ago)
        // New data: capacity = 10M (today)
        // With 30-day half-life, recent data should win.
        let oldSnaps = (0..<10).map { i -> CapacitySnapshot in
            let p = 10.0 + Double(i) * 8
            return snap(p, p / 100 * 5_000_000, ageDays: 45)
        }
        let newSnaps = (0..<10).map { i -> CapacitySnapshot in
            let p = 10.0 + Double(i) * 8
            return snap(p, p / 100 * 10_000_000, ageDays: 1)
        }
        let est = CapacityEstimator.estimate(oldSnaps + newSnaps, asOf: now)
        #expect(est != nil)
        // Recent capacity is 10M; estimate should be closer to 10M than 5M.
        #expect(est!.capacity > 7_500_000)
    }
}

@Suite("CapacityEstimator -- non-linearity")
struct CapacityEstimatorNonLinearityTests {
    @Test("flags non-linearity when residuals show systematic sign pattern")
    func detectsKneePattern() {
        // Data follows a knee: linear up to 60%, then flatter (Anthropic capping).
        let snaps: [CapacitySnapshot] = (0..<20).map { i in
            let p = 5.0 + Double(i) * 5
            let tokens: Double = p < 60 ? p / 100 * 8_000_000 : 0.6 * 8_000_000 + (p - 60) / 100 * 4_000_000
            return snap(p, tokens)
        }
        let est = CapacityEstimator.estimate(snaps, asOf: now)
        #expect(est != nil)
        #expect(est!.nonLinearityWarning == true)
    }

    @Test("does not flag clean linear data")
    func cleanLinearNoFlag() {
        let trueCapacity: Double = 6_000_000
        let percents = stride(from: 5.0, to: 95.0, by: 5.0).map { $0 }
        let snaps = percents.map { p in snap(p, p / 100 * trueCapacity) }
        let est = CapacityEstimator.estimate(snaps, asOf: now)
        #expect(est != nil)
        #expect(est!.nonLinearityWarning == false)
    }
}

// Lightweight deterministic RNG for reproducible noise in tests.
struct LinearCongruentialGenerator {
    private var state: UInt64
    init(seed: UInt64) { self.state = seed }
    mutating func nextDouble() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double(state >> 11) / Double(1 << 53)
    }
}
