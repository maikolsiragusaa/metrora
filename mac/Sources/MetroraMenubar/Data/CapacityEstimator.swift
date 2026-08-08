import Foundation

public struct CapacitySnapshot: Sendable, Equatable {
    public let percent: Double          // 0..100, Anthropic-reported utilization
    public let effectiveTokens: Double  // weighted sum of input/output/cache tokens consumed at capture
    public let capturedAt: Date

    public init(percent: Double, effectiveTokens: Double, capturedAt: Date) {
        self.percent = percent
        self.effectiveTokens = effectiveTokens
        self.capturedAt = capturedAt
    }
}

public enum CapacityConfidence: String, Sendable {
    case low, medium, solid
}

public struct CapacityEstimate: Sendable, Equatable {
    public let capacity: Double                 // tokens equivalent to 100%
    public let confidence: CapacityConfidence
    public let sampleSize: Int                  // post-decorrelation count
    public let nonLinearityWarning: Bool

    public init(capacity: Double, confidence: CapacityConfidence, sampleSize: Int, nonLinearityWarning: Bool) {
        self.capacity = capacity
        self.confidence = confidence
        self.sampleSize = sampleSize
        self.nonLinearityWarning = nonLinearityWarning
    }
}

public enum CapacityEstimator {
    private static let minSampleSize = 5
    private static let minPercentRange = 15.0
    private static let recencyHalfLifeSeconds: Double = 30 * 86400
    private static let solidR2 = 0.97
    private static let mediumR2 = 0.85
    private static let solidSampleThreshold = 15
    private static let mediumSampleThreshold = 6
    private static let nonLinearityRunLengthThreshold = 0.7

    public static func estimate(_ snapshots: [CapacitySnapshot], asOf now: Date = Date()) -> CapacityEstimate? {
        guard snapshots.count >= minSampleSize else { return nil }
        let percents = snapshots.map(\.percent)
        let range = (percents.max() ?? 0) - (percents.min() ?? 0)
        guard range >= minPercentRange else { return nil }

        let weighted = snapshots.map { snap -> (p: Double, t: Double, w: Double) in
            let ageSeconds = now.timeIntervalSince(snap.capturedAt)
            let weight = pow(0.5, max(0, ageSeconds) / recencyHalfLifeSeconds)
            return (snap.percent, snap.effectiveTokens, weight)
        }

        // Weighted least squares through origin: minimize sum(w * (t - p * cap/100)^2)
        // Solution: cap = 100 * sum(w * t * p) / sum(w * p * p)
        let numerator = weighted.reduce(0.0) { $0 + $1.w * $1.t * $1.p }
        let denominator = weighted.reduce(0.0) { $0 + $1.w * $1.p * $1.p }
        guard denominator > 0 else { return nil }
        let capacity = 100.0 * numerator / denominator
        guard capacity > 0 else { return nil }

        // Weighted R^2 against the through-origin fit.
        let weightedTokenSum = weighted.reduce(0.0) { $0 + $1.w * $1.t }
        let weightSum = weighted.reduce(0.0) { $0 + $1.w }
        let weightedMeanT = weightedTokenSum / max(weightSum, .ulpOfOne)
        let ssRes = weighted.reduce(0.0) { acc, s in
            let predicted = s.p * capacity / 100
            let diff = s.t - predicted
            return acc + s.w * diff * diff
        }
        let ssTot = weighted.reduce(0.0) { acc, s in
            let diff = s.t - weightedMeanT
            return acc + s.w * diff * diff
        }
        let r2 = ssTot > 0 ? max(0.0, 1.0 - ssRes / ssTot) : 0.0

        let n = snapshots.count
        let confidence: CapacityConfidence = {
            if n >= solidSampleThreshold && r2 >= solidR2 { return .solid }
            if n >= mediumSampleThreshold && r2 >= mediumR2 { return .medium }
            return .low
        }()

        let nonLinearityWarning = detectNonLinearity(snapshots: weighted, capacity: capacity)

        return CapacityEstimate(
            capacity: capacity,
            confidence: confidence,
            sampleSize: n,
            nonLinearityWarning: nonLinearityWarning
        )
    }

    /// Sign-test on residuals across the percent range. If residuals form a long monotonic run
    /// (e.g. all-negative in low percents then all-positive at high), the relationship isn't linear.
    private static func detectNonLinearity(
        snapshots: [(p: Double, t: Double, w: Double)],
        capacity: Double
    ) -> Bool {
        let sorted = snapshots.sorted { $0.p < $1.p }
        let signs = sorted.map { s -> Int in
            let predicted = s.p * capacity / 100
            let diff = s.t - predicted
            if abs(diff) < .ulpOfOne { return 0 }
            return diff > 0 ? 1 : -1
        }.filter { $0 != 0 }
        guard signs.count >= minSampleSize else { return false }

        // Longest single-sign run length / total
        var longestRun = 0
        var currentRun = 0
        var currentSign = 0
        for s in signs {
            if s == currentSign {
                currentRun += 1
            } else {
                longestRun = max(longestRun, currentRun)
                currentSign = s
                currentRun = 1
            }
        }
        longestRun = max(longestRun, currentRun)
        let runFraction = Double(longestRun) / Double(signs.count)
        return runFraction >= nonLinearityRunLengthThreshold
    }
}
