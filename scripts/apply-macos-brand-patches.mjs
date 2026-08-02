import { readFile, writeFile } from 'node:fs/promises'

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`)
  return source.replace(before, after)
}

const appPath = 'mac/Sources/CodeBurnMenubar/CodeBurnApp.swift'
let app = await readFile(appPath, 'utf8')

app = replaceOnce(
  app,
  `        let flameConfig = NSImage.SymbolConfiguration(pointSize: menubarTitleFontSize, weight: .medium)\n        let flame = NSImage(systemSymbolName: "flame.fill", accessibilityDescription: "CodeBurn")?\n            .withSymbolConfiguration(flameConfig)\n        flame?.isTemplate = true\n        button.image = flame`,
  `        button.image = Self.signalGridImage(size: menubarTitleFontSize, tint: nil)`,
  'initial status mark',
)

app = replaceOnce(
  app,
  '    private static func flameTint(for severity: QuotaSummary.Severity) -> NSColor? {',
  `    private static func signalGridImage(size: CGFloat, tint: NSColor?) -> NSImage? {
        let width = size * 1.28
        let image = NSImage(size: NSSize(width: width, height: size), flipped: false) { rect in
            let heights: [CGFloat] = [1.0, 0.78, 0.56, 0.56, 0.78, 1.0]
            let barWidth = rect.width * 0.085
            let gap = (rect.width - barWidth * CGFloat(heights.count)) / CGFloat(heights.count - 1)
            (tint ?? NSColor.labelColor).setFill()
            for (index, ratio) in heights.enumerated() {
                let height = rect.height * ratio
                let x = CGFloat(index) * (barWidth + gap)
                let y = index < 3 ? rect.height - height : 0
                NSBezierPath(roundedRect: NSRect(x: x, y: y, width: barWidth, height: height), xRadius: 1.2, yRadius: 1.2).fill()
            }
            return true
        }
        image.isTemplate = (tint == nil)
        image.accessibilityDescription = "Metrora"
        return image
    }

    private static func markTint(for severity: QuotaSummary.Severity) -> NSColor? {`,
  'status mark helper',
)

app = app.replaceAll('Self.flameTint(for:', 'Self.markTint(for:')
app = app.replaceAll('button.toolTip = "CodeBurn \\(menubarPeriod.menubarMetricLabel)"', 'button.toolTip = "Metrora \\(menubarPeriod.menubarMetricLabel)"')

app = replaceOnce(
  app,
  `        let baseConfig = NSImage.SymbolConfiguration(pointSize: menubarTitleFontSize, weight: .medium)
        // Tint the flame based on the worst-affected connected provider's quota.
        // Normal (<70%) keeps the template (auto white-on-dark / black-on-light);
        // warning/critical/danger override with a fixed palette color so the
        // user gets a glanceable signal even when the menu bar is busy.
        let aggregate = store.aggregateQuotaStatus
        var tint = Self.markTint(for: aggregate.severity)
        if tint == nil, store.isOverDailyBudget {
            tint = NSColor.systemYellow
        }
        let flameConfig: NSImage.SymbolConfiguration
        if let tint {
            flameConfig = baseConfig.applying(.init(paletteColors: [tint]))
        } else {
            flameConfig = baseConfig
        }
        let flame = NSImage(systemSymbolName: "flame.fill", accessibilityDescription: "CodeBurn")?
            .withSymbolConfiguration(flameConfig)
        flame?.isTemplate = (tint == nil)

        let attachment = NSTextAttachment()
        attachment.image = flame
        if let size = flame?.size {
            attachment.bounds = CGRect(x: 0, y: -3, width: size.width, height: size.height)
        }`,
  `        // Tint Signal Grid based on the worst-affected connected provider's quota.
        let aggregate = store.aggregateQuotaStatus
        var tint = Self.markTint(for: aggregate.severity)
        if tint == nil, store.isOverDailyBudget {
            tint = NSColor.systemYellow
        }
        let mark = Self.signalGridImage(size: menubarTitleFontSize, tint: tint)

        let attachment = NSTextAttachment()
        attachment.image = mark
        if let size = mark?.size {
            attachment.bounds = CGRect(x: 0, y: -3, width: size.width, height: size.height)
        }`,
  'attributed status mark',
)

const alertPattern = /    private func codeburnAlertIcon\(\) -> NSImage\? \{[\s\S]*?\n    \}\n\n    private /m
if (!alertPattern.test(app)) throw new Error('alert icon function not found')
app = app.replace(alertPattern, `    private func codeburnAlertIcon() -> NSImage? {
        Self.signalGridImage(size: 32, tint: NSColor.systemBlue)
    }

    private `)

await writeFile(appPath, app)

const contentPath = 'mac/Sources/CodeBurnMenubar/Views/MenuBarContent.swift'
let content = await readFile(contentPath, 'utf8')

content = replaceOnce(
  content,
  '                BurnFlame(size: flameSize, fillProgress: fillProgress, glowing: glowing)',
  '                SignalGridLoadingMark(size: flameSize, fillProgress: fillProgress, glowing: glowing)',
  'loading mark call',
)

const loadingPattern = /private struct BurnFlame: View \{[\s\S]*?\n\}\n\nprivate struct Header: View \{/m
if (!loadingPattern.test(content)) throw new Error('loading flame component not found')
content = content.replace(loadingPattern, `private struct SignalGridLoadingMark: View {
    let size: CGFloat
    let fillProgress: CGFloat
    let glowing: Bool

    private let heights: [CGFloat] = [1.0, 0.78, 0.56, 0.56, 0.78, 1.0]

    var body: some View {
        HStack(alignment: .bottom, spacing: size * 0.07) {
            ForEach(Array(heights.enumerated()), id: \\.offset) { index, ratio in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(
                        fillProgress >= CGFloat(index + 1) / CGFloat(heights.count)
                            ? Theme.brandAccent
                            : Theme.brandAccent.opacity(0.18)
                    )
                    .frame(width: size * 0.085, height: size * ratio)
            }
        }
        .frame(width: size * 1.3, height: size)
        .shadow(color: Theme.brandAccentGlow.opacity(glowing ? 0.45 : 0.15), radius: glowing ? 14 : 5)
    }
}

private struct Header: View {`)

content = replaceOnce(
  content,
  `                    (
                        Text("Code").foregroundStyle(.primary)
                        + Text("Burn").foregroundStyle(Theme.brandEmber)
                    )
                    .font(.system(size: 13, weight: .semibold))
                    .tracking(-0.15)
                    Text("AI Coding Cost Tracker")`,
  `                    Text("Metrora")
                    .foregroundStyle(.primary)
                    .font(.system(size: 13, weight: .semibold))
                    .tracking(-0.15)
                    Text("Local AI usage intelligence")`,
  'popover header',
)

await writeFile(contentPath, content)
console.log('Applied Metrora macOS menubar brand migration')
