import SwiftUI

struct SparklineView: View {
    let points: [Double]

    var body: some View {
        GeometryReader { geo in
            let cgPoints = makePoints(in: geo.size)
            let smooth = smoothPath(cgPoints)

            ZStack {
                // Gradient fill under the curve
                let fill = closedPath(smooth, width: geo.size.width, height: geo.size.height)
                fill.fill(
                    LinearGradient(
                        colors: [Theme.brandAccent.opacity(0.25), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

                // Smooth accent stroke
                smooth.stroke(
                    Theme.brandAccent.opacity(0.85),
                    style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round)
                )

                // Highlighted current-day point
                if let last = cgPoints.last {
                    Circle()
                        .fill(Theme.brandAccent)
                        .frame(width: 6, height: 6)
                        .overlay(
                            Circle()
                                .stroke(Color(NSColor.windowBackgroundColor).opacity(0.9), lineWidth: 1.3)
                        )
                        .position(last)
                }
            }
        }
    }

    // MARK: - Geometry

    private func makePoints(in size: CGSize) -> [CGPoint] {
        guard !points.isEmpty else { return [] }
        let w = size.width
        let h = size.height
        let maxV = points.max() ?? 1
        let minV = points.min() ?? 0
        let range = max(maxV - minV, 1)
        let count = max(points.count - 1, 1)
        let topPad: CGFloat = 5
        let bottomPad: CGFloat = 5
        let usable = max(h - topPad - bottomPad, 1)

        return points.enumerated().map { idx, v in
            CGPoint(
                x: w * CGFloat(idx) / CGFloat(count),
                y: h - bottomPad - usable * CGFloat(v - minV) / CGFloat(range)
            )
        }
    }

    /// Catmull-Rom → cubic bezier. Standard smooth interpolation, no overshoot.
    private func smoothPath(_ pts: [CGPoint]) -> Path {
        var path = Path()
        guard pts.count >= 2 else { return path }
        path.move(to: pts[0])

        let tension: CGFloat = 0.5
        for i in 0..<(pts.count - 1) {
            let p0 = i > 0 ? pts[i - 1] : pts[i]
            let p1 = pts[i]
            let p2 = pts[i + 1]
            let p3 = i + 2 < pts.count ? pts[i + 2] : p2

            let cp1 = CGPoint(
                x: p1.x + (p2.x - p0.x) * tension / 3,
                y: p1.y + (p2.y - p0.y) * tension / 3
            )
            let cp2 = CGPoint(
                x: p2.x - (p3.x - p1.x) * tension / 3,
                y: p2.y - (p3.y - p1.y) * tension / 3
            )
            path.addCurve(to: p2, control1: cp1, control2: cp2)
        }
        return path
    }

    /// Close the path along the bottom to form a fill region.
    private func closedPath(_ line: Path, width: CGFloat, height: CGFloat) -> Path {
        var p = line
        p.addLine(to: CGPoint(x: width, y: height))
        p.addLine(to: CGPoint(x: 0, y: height))
        p.closeSubpath()
        return p
    }
}
