package eu.metrora.app

import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.UsageSnapshot

internal fun testCredentials(
    host: String = "desktop.local",
    token: String = "token-1",
): PairingCredentials = PairingCredentials(
    host = host,
    port = 7777,
    desktopName = "Metrora Desktop",
    serverFingerprint = "ab".repeat(32),
    clientFingerprint = "cd".repeat(32),
    token = token,
    pairedAtEpochMs = 1_700_000_000_000L,
)

internal fun testSnapshot(
    desktopId: String = "ab".repeat(32),
    retrievedAtEpochMs: Long = 1_700_000_001_000L,
): UsageSnapshot = UsageSnapshot(
    desktopId = desktopId,
    desktopName = "Metrora Desktop",
    generatedAtEpochMs = 1_700_000_000_500L,
    periodLabel = "This month",
    costMicrosUsd = 750_000L,
    calls = 5L,
    sessions = 2L,
    inputTokens = 100L,
    outputTokens = 50L,
    cacheReadTokens = 20L,
    cacheWriteTokens = 10L,
    cacheHitPercent = 16.7,
    topModels = listOf(eu.metrora.app.data.ModelUsage("Model A", 5L, 750_000L)),
    retrievedAtEpochMs = retrievedAtEpochMs,
)

internal fun testFailure(
    operation: MetroraOperation,
    category: MetroraFailureCategory,
    reason: MetroraFailureReason,
): MetroraException = MetroraException(MetroraFailure(operation, category, reason, "test detail"))
