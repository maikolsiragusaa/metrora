package eu.metrora.app.data

enum class StorageIssue {
    CORRUPTED,
    KEY_UNAVAILABLE,
    UNREADABLE,
}

sealed interface StorageRead<out T> {
    data object Missing : StorageRead<Nothing>

    data class Present<T>(val value: T) : StorageRead<T>

    data class Corrupted(val issue: StorageIssue) : StorageRead<Nothing>
}
