package eu.metrora.app

/** Operations that can change the companion's product state. */
enum class MetroraOperation {
    RESTORE,
    DISCOVER,
    PAIR,
    REFRESH,
    REVOKE,
    LOCAL_ACTION,
}

/** Broad classes are intentionally stable so the UI never needs to inspect exceptions. */
enum class MetroraFailureCategory {
    CONNECTIVITY,
    IDENTITY_SECURITY,
    COMPATIBILITY,
    USER_CANCELLATION,
    MALFORMED_RESPONSE,
    LOCAL_STATE,
    UNEXPECTED,
}

enum class MetroraFailureReason {
    INVALID_HOST,
    INVALID_PORT,
    DESKTOP_UNREACHABLE,
    TIMEOUT,
    DESKTOP_NOT_METRORA,
    COMPANION_API_UNAVAILABLE,
    PROTOCOL_VERSION_UNSUPPORTED,
    PAIRING_NOT_AVAILABLE,
    PAIRING_DECLINED_OR_EXPIRED,
    ALREADY_PAIRED,
    CERTIFICATE_MISMATCH,
    DESKTOP_IDENTITY_CHANGED,
    LOCAL_IDENTITY_CHANGED,
    CONFIRMATION_CODE_MISMATCH,
    UNAUTHORIZED,
    REMOTE_REVOCATION_NOT_CONFIRMED,
    MALFORMED_RESPONSE,
    RESPONSE_TOO_LARGE,
    STORAGE_CORRUPTED,
    KEY_UNAVAILABLE,
    INCONSISTENT_LOCAL_STATE,
    UNEXPECTED_SERVER_BEHAVIOR,
    UNKNOWN,
}

data class MetroraFailure(
    val operation: MetroraOperation,
    val category: MetroraFailureCategory,
    val reason: MetroraFailureReason,
    /** Safe diagnostic context for an optional Details/Advanced surface. */
    val technicalDetail: String? = null,
)

class MetroraException(
    val failure: MetroraFailure,
    cause: Throwable? = null,
) : Exception(failure.reason.name, cause)

enum class MetroraConnectionState {
    UNPAIRED,
    PAIRING,
    VERIFYING_SAS,
    WAITING_FOR_DESKTOP_APPROVAL,
    RESTORED,
    PAIRED_NO_SNAPSHOT,
    CONNECTED,
    REFRESHING,
    OFFLINE_WITH_SNAPSHOT,
    OFFLINE_NO_SNAPSHOT,
    REVOKED_OR_UNAUTHORIZED,
    RECOVERY_REQUIRED,
    ERROR,
    REVOKING,
    FORGETTING,
}

enum class MetroraNotice {
    PAIRING_CANCELLED,
    PAIRING_COMPLETE,
    USAGE_REFRESHED,
    PAIRED_WITHOUT_USAGE,
    LOCAL_PAIRING_FORGOTTEN,
    REMOTE_REVOCATION_COMPLETE,
    REMOTE_REVOCATION_CONFIRMED_LOCAL_CLEANUP_NEEDED,
    SNAPSHOT_RECOVERED,
}
