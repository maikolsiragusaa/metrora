package eu.metrora.app.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.ui.graphics.vector.ImageVector
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraFailure
import eu.metrora.app.MetroraFailureReason
import eu.metrora.app.MetroraNotice
import eu.metrora.app.MetroraOperation
import eu.metrora.app.R
import eu.metrora.app.MetroraUiState
import eu.metrora.app.data.AnalyzeAccountingCoverage
import eu.metrora.app.data.DetailCoverage
import java.math.BigDecimal
import java.text.DateFormat
import java.text.NumberFormat
import java.util.Date
import java.util.Locale

internal enum class StatusTone {
    POSITIVE,
    SAVED,
    WARNING,
    ERROR,
    PROGRESS,
    NEUTRAL,
}

internal data class StatusCopy(
    val title: Int,
    val body: Int,
    val icon: ImageVector,
    val iconDescription: Int,
    val tone: StatusTone,
)

internal enum class FreshnessKind {
    FRESH,
    CHECKING,
    SAVED,
    REFRESH_FAILED,
}

internal data class FreshnessPresentation(
    val label: Int,
    val kind: FreshnessKind,
)

internal fun freshnessPresentation(state: MetroraUiState): FreshnessPresentation = when {
    state.isDemo -> FreshnessPresentation(
        R.string.data_demo,
        FreshnessKind.FRESH,
    )
    state.status == MetroraConnectionState.REFRESHING -> FreshnessPresentation(
        R.string.data_refreshing,
        FreshnessKind.CHECKING,
    )
    state.status == MetroraConnectionState.CONNECTED -> FreshnessPresentation(
        R.string.data_fresh,
        FreshnessKind.FRESH,
    )
    state.failure?.operation == MetroraOperation.REFRESH -> FreshnessPresentation(
        R.string.data_saved_after_failed_refresh,
        FreshnessKind.REFRESH_FAILED,
    )
    else -> FreshnessPresentation(
        R.string.data_saved_on_phone,
        FreshnessKind.SAVED,
    )
}

internal fun statusCopy(status: MetroraConnectionState): StatusCopy = when (status) {
    MetroraConnectionState.UNPAIRED -> StatusCopy(
        R.string.status_not_connected,
        R.string.status_not_connected_body,
        Icons.Outlined.LinkOff,
        R.string.desktop_unavailable_icon,
        StatusTone.NEUTRAL,
    )
    MetroraConnectionState.PAIRING -> StatusCopy(
        R.string.status_connecting,
        R.string.status_connecting_body,
        Icons.Outlined.Refresh,
        R.string.desktop_check_icon,
        StatusTone.PROGRESS,
    )
    MetroraConnectionState.VERIFYING_SAS -> StatusCopy(
        R.string.status_verify_connection,
        R.string.status_verify_connection_body,
        Icons.Outlined.Security,
        R.string.security_icon,
        StatusTone.PROGRESS,
    )
    MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL -> StatusCopy(
        R.string.status_waiting_approval,
        R.string.status_waiting_approval_body,
        Icons.Outlined.Security,
        R.string.security_icon,
        StatusTone.PROGRESS,
    )
    MetroraConnectionState.RESTORED -> StatusCopy(
        R.string.status_saved_on_phone,
        R.string.status_saved_on_phone_body,
        Icons.Outlined.Refresh,
        R.string.desktop_check_icon,
        StatusTone.SAVED,
    )
    MetroraConnectionState.PAIRED_NO_SNAPSHOT -> StatusCopy(
        R.string.status_paired_no_snapshot,
        R.string.status_paired_no_snapshot_body,
        Icons.Outlined.Refresh,
        R.string.desktop_check_icon,
        StatusTone.SAVED,
    )
    MetroraConnectionState.CONNECTED -> StatusCopy(
        R.string.status_up_to_date,
        R.string.status_online_body,
        Icons.Outlined.CheckCircle,
        R.string.online_icon,
        StatusTone.POSITIVE,
    )
    MetroraConnectionState.REFRESHING -> StatusCopy(
        R.string.status_updating,
        R.string.status_updating_body,
        Icons.Outlined.Refresh,
        R.string.online_icon,
        StatusTone.PROGRESS,
    )
    MetroraConnectionState.DEMO -> StatusCopy(
        R.string.status_demo,
        R.string.status_demo_body,
        Icons.Outlined.Info,
        R.string.demo_data_a11y,
        StatusTone.POSITIVE,
    )
    MetroraConnectionState.OFFLINE_WITH_SNAPSHOT -> StatusCopy(
        R.string.status_desktop_unavailable,
        R.string.status_cached_body,
        Icons.Outlined.CloudOff,
        R.string.desktop_unavailable_icon,
        StatusTone.WARNING,
    )
    MetroraConnectionState.OFFLINE_NO_SNAPSHOT -> StatusCopy(
        R.string.status_no_snapshot,
        R.string.status_no_snapshot_body,
        Icons.Outlined.CloudOff,
        R.string.desktop_unavailable_icon,
        StatusTone.WARNING,
    )
    MetroraConnectionState.REVOKED_OR_UNAUTHORIZED -> StatusCopy(
        R.string.status_access_attention,
        R.string.status_access_attention_body,
        Icons.Outlined.Security,
        R.string.security_icon,
        StatusTone.ERROR,
    )
    MetroraConnectionState.RECOVERY_REQUIRED -> StatusCopy(
        R.string.status_recovery_required,
        R.string.status_recovery_body,
        Icons.Outlined.WarningAmber,
        R.string.recovery_icon,
        StatusTone.ERROR,
    )
    MetroraConnectionState.ERROR -> StatusCopy(
        R.string.status_problem,
        R.string.status_problem_body,
        Icons.Outlined.ErrorOutline,
        R.string.recovery_icon,
        StatusTone.ERROR,
    )
    MetroraConnectionState.REVOKING -> StatusCopy(
        R.string.status_revoking,
        R.string.status_updating_body,
        Icons.Outlined.LinkOff,
        R.string.security_icon,
        StatusTone.PROGRESS,
    )
    MetroraConnectionState.FORGETTING -> StatusCopy(
        R.string.status_forgetting,
        R.string.status_updating_body,
        Icons.Outlined.DeleteOutline,
        R.string.recovery_icon,
        StatusTone.PROGRESS,
    )
}

internal fun noticeResource(notice: MetroraNotice): Int = when (notice) {
    MetroraNotice.PAIRING_CANCELLED -> R.string.notice_pairing_cancelled
    MetroraNotice.PAIRING_COMPLETE -> R.string.notice_pairing_complete
    MetroraNotice.USAGE_REFRESHED -> R.string.notice_usage_refreshed
    MetroraNotice.PAIRED_WITHOUT_USAGE -> R.string.notice_paired_without_usage
    MetroraNotice.LOCAL_PAIRING_FORGOTTEN -> R.string.notice_local_forgotten
    MetroraNotice.REMOTE_REVOCATION_COMPLETE -> R.string.notice_remote_revocation_complete
    MetroraNotice.REMOTE_REVOCATION_CONFIRMED_LOCAL_CLEANUP_NEEDED -> R.string.notice_remote_revocation_cleanup
    MetroraNotice.SNAPSHOT_RECOVERED -> R.string.notice_snapshot_recovered
}

internal fun failureTitleResource(failure: MetroraFailure): Int = when (failure.operation) {
    MetroraOperation.REFRESH -> R.string.failure_refresh_title
    MetroraOperation.REVOKE -> R.string.failure_revoke_title
    MetroraOperation.RESTORE,
    MetroraOperation.LOCAL_ACTION,
    -> R.string.failure_action_title
    MetroraOperation.DISCOVER,
    MetroraOperation.PAIR,
    -> R.string.failure_connection_title
}

internal fun failureResource(failure: MetroraFailure): Int = when (failure.reason) {
    MetroraFailureReason.INVALID_HOST -> R.string.error_invalid_host
    MetroraFailureReason.INVALID_PORT -> R.string.error_invalid_port
    MetroraFailureReason.DESKTOP_UNREACHABLE -> R.string.error_unreachable
    MetroraFailureReason.TIMEOUT -> R.string.error_timeout
    MetroraFailureReason.DESKTOP_NOT_METRORA -> R.string.error_not_metrora
    MetroraFailureReason.COMPANION_API_UNAVAILABLE -> R.string.error_api_unavailable
    MetroraFailureReason.PROTOCOL_VERSION_UNSUPPORTED -> R.string.error_version
    MetroraFailureReason.PAIRING_NOT_AVAILABLE -> R.string.error_pairing_unavailable
    MetroraFailureReason.PAIRING_DECLINED_OR_EXPIRED -> R.string.error_pairing_declined
    MetroraFailureReason.ALREADY_PAIRED -> R.string.error_already_paired
    MetroraFailureReason.CERTIFICATE_MISMATCH -> R.string.error_certificate
    MetroraFailureReason.DESKTOP_IDENTITY_CHANGED -> R.string.error_desktop_identity_changed
    MetroraFailureReason.LOCAL_IDENTITY_CHANGED -> R.string.error_local_identity_changed
    MetroraFailureReason.CONFIRMATION_CODE_MISMATCH -> R.string.error_confirmation_code
    MetroraFailureReason.UNAUTHORIZED -> R.string.error_unauthorized
    MetroraFailureReason.REMOTE_REVOCATION_NOT_CONFIRMED -> R.string.error_revoke_unconfirmed
    MetroraFailureReason.MALFORMED_RESPONSE,
    MetroraFailureReason.RESPONSE_TOO_LARGE,
    -> R.string.error_malformed
    MetroraFailureReason.STORAGE_CORRUPTED,
    MetroraFailureReason.KEY_UNAVAILABLE,
    -> R.string.error_local_state
    MetroraFailureReason.INCONSISTENT_LOCAL_STATE -> R.string.error_recovery
    MetroraFailureReason.UNEXPECTED_SERVER_BEHAVIOR,
    MetroraFailureReason.UNKNOWN,
    -> R.string.error_unexpected
}

internal fun formatUsd(micros: Long): String = NumberFormat.getCurrencyInstance(Locale.US)
    .format(BigDecimal.valueOf(micros).movePointLeft(6))

internal fun formatEvidenceUsd(micros: Long): String = when {
    micros in 1 until 10_000 -> "<$0.01"
    else -> formatUsd(micros)
}

internal fun formatCompact(value: Long): String = when {
    value >= 1_000_000_000 -> String.format(Locale.US, "%.1fB", value / 1_000_000_000.0)
    value >= 1_000_000 -> String.format(Locale.US, "%.1fM", value / 1_000_000.0)
    value >= 1_000 -> String.format(Locale.US, "%.1fK", value / 1_000.0)
    else -> value.toString()
}

/**
 * Keeps a factual partial token subtotal visible without presenting it as a
 * complete period total. A null result means the UI must use its coverage
 * label instead of displaying a numeric value.
 */
internal fun tokenMetricValue(coverage: DetailCoverage, totalTokens: Long): String? = when (coverage) {
    DetailCoverage.COMPLETE -> formatCompact(totalTokens)
    DetailCoverage.PARTIAL -> totalTokens.takeIf { it > 0L }?.let { "${formatCompact(it)}+" }
    DetailCoverage.UNAVAILABLE -> null
}

internal enum class AnalyzeCoverageDimension {
    PRICING,
    ACCOUNTING_COST,
    TOKEN,
    MODEL_DETAIL,
}

internal data class AnalyzeCoveragePresentation(
    val pricingCoverage: Double?,
    val accountingCostCoverage: Double?,
    val tokenCoverage: DetailCoverage,
    val modelDetailCoverage: DetailCoverage,
)

/**
 * Keep Analyze's factual coverage dimensions sourced from their own
 * authorities. In particular, accounting cost completeness is not pricing
 * coverage, even when both values happen to be percentages.
 */
internal fun analyzeCoveragePresentation(
    canonicalPricingCoverage: Double?,
    accountingCoverage: AnalyzeAccountingCoverage?,
    tokenCoverage: DetailCoverage,
    modelDetailCoverage: DetailCoverage,
): AnalyzeCoveragePresentation = AnalyzeCoveragePresentation(
    pricingCoverage = canonicalPricingCoverage,
    accountingCostCoverage = accountingCoverage?.cost,
    tokenCoverage = tokenCoverage,
    modelDetailCoverage = modelDetailCoverage,
)

internal fun analyzeCoverageLabel(dimension: AnalyzeCoverageDimension): Int = when (dimension) {
    AnalyzeCoverageDimension.PRICING -> R.string.pricing_coverage_short
    AnalyzeCoverageDimension.ACCOUNTING_COST -> R.string.cost_accounting_coverage
    AnalyzeCoverageDimension.TOKEN -> R.string.token_coverage
    AnalyzeCoverageDimension.MODEL_DETAIL -> R.string.models_coverage
}

internal fun formatDate(epochMs: Long): String = DateFormat.getDateTimeInstance(
    DateFormat.MEDIUM,
    DateFormat.SHORT,
).format(Date(epochMs))
