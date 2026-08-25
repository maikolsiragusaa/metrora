package eu.metrora.app.network

import eu.metrora.app.data.CAPACITY_CONTRACT_VERSION
import eu.metrora.app.data.CAPACITY_SCOPE_KEY
import eu.metrora.app.data.CapacitySnapshot
import eu.metrora.app.data.PairingCredentials
import java.time.Instant
import org.json.JSONObject

internal object CompanionCapacityV1Parser {
    fun parse(
        raw: String,
        credentials: PairingCredentials,
        retrievedAtEpochMs: Long = System.currentTimeMillis(),
    ): CapacitySnapshot {
        val root = JSONObject(raw)
        require(root.getString("kind") == MetroraProtocol.CAPACITY_KIND) {
            "The desktop returned an unsupported Capacity payload."
        }
        require(root.getInt("version") == CAPACITY_CONTRACT_VERSION) {
            "The desktop returned an unsupported Capacity schema version."
        }
        require(root.getString("desktopId") == credentials.serverFingerprint) {
            "The desktop returned Capacity for a different identity."
        }
        return try {
            val scope = root.getJSONObject("scope")
            require(scope.getString("id") == CAPACITY_SCOPE_KEY) {
                "The desktop returned an unsupported Capacity scope."
            }
            val generatedAt = Instant.parse(root.getString("generatedAt")).toEpochMilli()
            val snapshot = CapacitySnapshot.fromJson(
                root.put("generatedAtEpochMs", generatedAt)
                    .put("retrievedAtEpochMs", retrievedAtEpochMs.coerceAtLeast(0L))
                    .put("scopeKey", scope.getString("id"))
                    .toString(),
            )
            require(snapshot.desktopId == credentials.serverFingerprint) {
                "The desktop returned Capacity for a different identity."
            }
            snapshot
        } catch (error: IllegalArgumentException) {
            throw error
        } catch (error: Exception) {
            throw IllegalArgumentException("The desktop returned malformed Capacity data.", error)
        }
    }
}
