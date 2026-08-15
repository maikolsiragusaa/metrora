package eu.metrora.app.network

import java.net.URI

data class PairingBootstrapEndpoint(
    val host: String,
    val port: Int,
)

/**
 * Parses only a bounded connection bootstrap. The returned endpoint still
 * goes through discovery, certificate identity checks and SAS approval; a QR
 * value can never create credentials by itself.
 */
object PairingBootstrap {
    private const val MAX_PAYLOAD_LENGTH = 2_048
    private const val SCHEME = "metrora"
    private const val CONNECT_HOST = "connect"

    fun parse(raw: String): PairingBootstrapEndpoint {
        val value = raw.trim()
        require(value.isNotEmpty() && value.length <= MAX_PAYLOAD_LENGTH) {
            "The QR code payload is invalid."
        }

        val uri = runCatching { URI(value) }.getOrElse {
            throw IllegalArgumentException("The QR code payload is invalid.", it)
        }
        return when (uri.scheme?.lowercase()) {
            SCHEME -> parseMetroraUri(uri)
            "https" -> parseHttpsUri(uri)
            else -> throw IllegalArgumentException("The QR code is not a Metrora connection.")
        }
    }

    private fun parseMetroraUri(uri: URI): PairingBootstrapEndpoint {
        require(uri.host.equals(CONNECT_HOST, ignoreCase = true) || uri.path == "/connect") {
            "The QR code is not a Metrora connection."
        }
        val query = queryParameters(uri.rawQuery)
        val address = query["address"] ?: query["endpoint"]
        if (address != null) return parseAddress(address)

        val host = query["host"]?.trim().orEmpty()
        require(host.isNotBlank()) { "The QR code does not contain a computer address." }
        val port = query["port"]?.toIntOrNull() ?: MetroraProtocol.DEFAULT_PORT
        return PairingBootstrapEndpoint(MetroraProtocol.normalizeHost(host), MetroraProtocol.validatePort(port))
    }

    private fun parseHttpsUri(uri: URI): PairingBootstrapEndpoint {
        val host = uri.host ?: throw IllegalArgumentException("The QR code does not contain a computer address.")
        require(uri.path.isNullOrBlank() || uri.path == "/") {
            "The QR code does not contain a computer address."
        }
        return PairingBootstrapEndpoint(
            host = MetroraProtocol.normalizeHost(host),
            port = MetroraProtocol.validatePort(uri.port.takeIf { it > 0 } ?: MetroraProtocol.DEFAULT_PORT),
        )
    }

    private fun parseAddress(raw: String): PairingBootstrapEndpoint {
        val value = raw.trim()
        require(value.isNotBlank() && !value.contains("//")) { "The QR code address is invalid." }
        val bracketed = value.startsWith("[")
        val separator = if (bracketed) value.indexOf("]:") else value.lastIndexOf(':')
        val host = if (separator > 0) {
            if (bracketed) value.substring(1, separator) else value.substring(0, separator)
        } else {
            value.removePrefix("[").removeSuffix("]")
        }
        val port = if (separator > 0) value.substring(separator + if (bracketed) 2 else 1).toIntOrNull()
            ?: throw IllegalArgumentException("The QR code port is invalid.")
        else MetroraProtocol.DEFAULT_PORT
        return PairingBootstrapEndpoint(MetroraProtocol.normalizeHost(host), MetroraProtocol.validatePort(port))
    }

    private fun queryParameters(raw: String?): Map<String, String> = raw.orEmpty()
        .split('&')
        .asSequence()
        .filter(String::isNotBlank)
        .mapNotNull { pair ->
            val separator = pair.indexOf('=')
            if (separator <= 0) return@mapNotNull null
            val key = decode(pair.substring(0, separator))
            val value = decode(pair.substring(separator + 1))
            key to value
        }
        .toMap()

    private fun decode(value: String): String = java.net.URLDecoder.decode(value, Charsets.UTF_8.name())
}
