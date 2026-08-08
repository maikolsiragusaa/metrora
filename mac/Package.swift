// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MetroraMenubar",
    platforms: [
        // macOS 14 (Sonoma) is the floor: matches Info.plist LSMinimumSystemVersion,
        // the CLI install guard (MIN_MACOS_MAJOR=14), and mac/README. The earlier .v15
        // bump for NSAttributedString(attachment:) was a misdiagnosis, that initializer
        // is AppKit since macOS 10.0, so the binary's minos must not exclude Sonoma users.
        .macOS(.v14)
    ],
    products: [
        .executable(name: "MetroraMenubar", targets: ["MetroraMenubar"])
    ],
    targets: [
        .executableTarget(
            name: "MetroraMenubar",
            path: "Sources/MetroraMenubar",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency")
            ]
        ),
        .testTarget(
            name: "MetroraMenubarTests",
            dependencies: ["MetroraMenubar"],
            path: "Tests/MetroraMenubarTests"
        )
    ]
)
