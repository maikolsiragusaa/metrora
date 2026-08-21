package eu.metrora.app.ui

import com.google.zxing.BinaryBitmap
import com.google.zxing.LuminanceSource
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.multi.qrcode.QRCodeMultiReader
import com.google.zxing.qrcode.QRCodeReader

/**
 * QR-only decoding helpers backed by ZXing Core.
 *
 * These helpers are deliberately local and provider-free: they receive pixels
 * or luminance bytes already present on-device and return only the decoded raw
 * QR payload. Pairing validation remains owned by the existing Metrora pairing
 * authority.
 */
internal fun decodeSingleQrLuminance(
    width: Int,
    height: Int,
    luminance: ByteArray,
): String? {
    require(width > 0 && height > 0) { "QR frame dimensions must be positive" }
    require(luminance.size >= width * height) { "QR frame luminance buffer is too small" }

    return decodeSingleQr(
        PlanarYUVLuminanceSource(
            luminance,
            width,
            height,
            0,
            0,
            width,
            height,
            false,
        ),
    )
}

internal fun decodeQrBitmapPixels(
    width: Int,
    height: Int,
    pixels: IntArray,
): List<String> {
    require(width > 0 && height > 0) { "QR image dimensions must be positive" }
    require(pixels.size >= width * height) { "QR image pixel buffer is too small" }

    return decodeMultipleQr(RGBLuminanceSource(width, height, pixels))
}

private fun decodeSingleQr(source: LuminanceSource): String? =
    decodeSingleQrAttempt(source) ?: decodeSingleQrAttempt(source.invert())

private fun decodeSingleQrAttempt(source: LuminanceSource): String? {
    val reader = QRCodeReader()
    return try {
        reader.decode(BinaryBitmap(HybridBinarizer(source))).text
    } catch (_: ReaderException) {
        null
    } finally {
        reader.reset()
    }
}

private fun decodeMultipleQr(source: LuminanceSource): List<String> {
    val direct = decodeMultipleQrAttempt(source)
    return if (direct.isNotEmpty()) direct else decodeMultipleQrAttempt(source.invert())
}

private fun decodeMultipleQrAttempt(source: LuminanceSource): List<String> {
    val reader = QRCodeMultiReader()
    return try {
        reader.decodeMultiple(BinaryBitmap(HybridBinarizer(source))).map { it.text }
    } catch (_: ReaderException) {
        emptyList()
    } finally {
        reader.reset()
    }
}
