package eu.metrora.app.data

/**
 * Exact cost/call remainder that cannot be assigned to a retained named
 * model. It is deliberately not a model row and carries no inferred identity
 * or token split.
 */
data class ModelAccountingGap(
    val costMicrosUsd: Long,
    val calls: Long,
) {
    init {
        require(costMicrosUsd >= 0L) { "Model accounting gap cost cannot be negative." }
        require(calls >= 0L) { "Model accounting gap calls cannot be negative." }
        require(costMicrosUsd > 0L || calls > 0L) { "Model accounting gap must be material." }
    }
}
