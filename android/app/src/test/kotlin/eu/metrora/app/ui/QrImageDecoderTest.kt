package eu.metrora.app.ui

import com.google.zxing.BarcodeFormat
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import eu.metrora.app.network.PairingBootstrap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QrImageDecoderTest {
    @Test
    fun no_qr_result_maps_to_no_qr_failure() {
        var callbackCount = 0

        val handling = handoffQrImageResult(classifyQrImageResults(emptyList())) {
            callbackCount++
            true
        }

        assertEquals(
            QrImageImportHandling.Failed(QrImageImportError.NO_QR_CODE),
            handling,
        )
        assertEquals(0, callbackCount)
    }

    @Test
    fun exactly_one_qr_with_raw_value_is_accepted_for_callback_handoff() {
        val raw = "metrora://connect?host=desktop.local&port=7777"
        var handedOff: String? = null

        val handling = handoffQrImageResult(classifyQrImageResults(listOf(raw))) {
            handedOff = it
            true
        }

        assertEquals(QrImageImportHandling.Accepted, handling)
        assertEquals(raw, handedOff)
    }

    @Test
    fun null_or_blank_raw_value_fails_closed() {
        val nullHandling = handoffQrImageResult(classifyQrImageResults(listOf(null))) { true }
        val blankHandling = handoffQrImageResult(classifyQrImageResults(listOf("  \n\t"))) { true }

        assertEquals(
            QrImageImportHandling.Failed(QrImageImportError.BLANK_RAW_VALUE),
            nullHandling,
        )
        assertEquals(
            QrImageImportHandling.Failed(QrImageImportError.BLANK_RAW_VALUE),
            blankHandling,
        )
    }

    @Test
    fun multiple_qr_results_fail_closed_without_selecting_one() {
        var handedOff: String? = null

        val handling = handoffQrImageResult(classifyQrImageResults(listOf("first", "second"))) {
            handedOff = it
            true
        }

        assertEquals(
            QrImageImportHandling.Failed(QrImageImportError.MULTIPLE_QR_CODES),
            handling,
        )
        assertNull(handedOff)
    }

    @Test
    fun image_decode_exception_maps_to_readable_failure() {
        val handling = handoffQrImageResult(QrImageImportResult.ImageDecodeFailure) { true }

        assertEquals(
            QrImageImportHandling.Failed(QrImageImportError.IMAGE_DECODE_FAILURE),
            handling,
        )
    }

    @Test
    fun picker_cancellation_is_ignored_without_callback_or_error() {
        var callbackCount = 0

        val handling = handoffQrImageResult(QrImageImportResult.Cancelled) {
            callbackCount++
            true
        }

        assertEquals(QrImageImportHandling.Cancelled, handling)
        assertEquals(0, callbackCount)
    }

    @Test
    fun invalid_metrora_payload_reaches_existing_pairing_authority() {
        val raw = "https://example.com/account"
        var handedOff: String? = null

        val handling = handoffQrImageResult(QrImageImportResult.Payload(raw)) {
            handedOff = it
            runCatching { PairingBootstrap.parse(it) }.isSuccess
        }

        assertEquals(QrImageImportHandling.Failed(QrImageImportError.INVALID_PAYLOAD), handling)
        assertEquals(raw, handedOff)
    }

    @Test
    fun successful_import_calls_on_payload_exactly_once() {
        val operation = QrImageDecodeOperation()
        var callbackCount = 0

        if (operation.tryDeliver()) {
            handoffQrImageResult(QrImageImportResult.Payload("metrora://connect?host=desktop.local")) {
                callbackCount++
                true
            }
        }
        if (operation.tryDeliver()) {
            callbackCount++
        }

        assertEquals(1, callbackCount)
    }

    @Test
    fun stale_or_repeated_import_cannot_deliver_a_second_pairing_result() {
        val staleOperation = QrImageDecodeOperation()
        val currentOperation = QrImageDecodeOperation()
        var callbackCount = 0

        staleOperation.cancel()
        if (staleOperation.tryDeliver()) callbackCount++
        if (currentOperation.tryDeliver()) callbackCount++
        if (currentOperation.tryDeliver()) callbackCount++

        assertFalse(staleOperation.isActive())
        assertEquals(1, callbackCount)
    }

    @Test
    fun valid_raw_payload_remains_accepted_by_existing_camera_callback_contract() {
        val raw = "metrora://connect?host=desktop.local&port=7777"
        var handedOff: String? = null

        val handling = handoffQrImageResult(QrImageImportResult.Payload(raw)) {
            handedOff = it
            PairingBootstrap.parse(it).host == "desktop.local"
        }

        assertTrue(handling == QrImageImportHandling.Accepted)
        assertEquals(raw, handedOff)
    }

    @Test
    fun system_thumbnail_does_not_reapply_source_exif_orientation() {
        assertFalse(
            shouldApplySourceExifOrientation(QrImageBitmapSource.SYSTEM_THUMBNAIL),
        )
    }

    @Test
    fun direct_decode_still_applies_source_exif_orientation() {
        assertTrue(
            shouldApplySourceExifOrientation(QrImageBitmapSource.DIRECT_DECODE),
        )
    }

    @Test
    fun zxing_camera_luminance_decoder_round_trips_pairing_payload() {
        val raw = "metrora://connect?host=desktop.local&port=7777&token=test"
        val matrix = qrMatrix(raw)

        assertEquals(
            raw,
            decodeSingleQrLuminance(matrix.width, matrix.height, matrix.toLuminance()),
        )
    }

    @Test
    fun zxing_camera_luminance_decoder_handles_inverted_qr() {
        val raw = "metrora://connect?host=desktop.local&port=7777&token=inverted"
        val matrix = qrMatrix(raw)
        val inverted = matrix.toLuminance().also { bytes ->
            for (index in bytes.indices) {
                bytes[index] = (255 - (bytes[index].toInt() and 0xff)).toByte()
            }
        }

        assertEquals(raw, decodeSingleQrLuminance(matrix.width, matrix.height, inverted))
    }

    @Test
    fun zxing_bitmap_pixel_decoder_round_trips_imported_qr() {
        val raw = "metrora://connect?host=desktop.local&port=7777&token=image"
        val matrix = qrMatrix(raw)

        assertEquals(
            listOf(raw),
            decodeQrBitmapPixels(matrix.width, matrix.height, matrix.toArgbPixels()),
        )
    }

    private fun qrMatrix(raw: String): BitMatrix =
        QRCodeWriter().encode(raw, BarcodeFormat.QR_CODE, 256, 256)

    private fun BitMatrix.toLuminance(): ByteArray = ByteArray(width * height) { index ->
        val x = index % width
        val y = index / width
        if (get(x, y)) 0 else 0xff.toByte()
    }

    private fun BitMatrix.toArgbPixels(): IntArray = IntArray(width * height) { index ->
        val x = index % width
        val y = index / width
        if (get(x, y)) 0xff000000.toInt() else 0xffffffff.toInt()
    }
}
