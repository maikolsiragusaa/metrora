package eu.metrora.app.ui

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.util.Size
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import java.io.Closeable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

internal sealed interface QrImageImportResult {
    data object Cancelled : QrImageImportResult
    data object NoQrCode : QrImageImportResult
    data object MultipleQrCodes : QrImageImportResult
    data object BlankRawValue : QrImageImportResult
    data object ImageDecodeFailure : QrImageImportResult
    data class Payload(val rawValue: String) : QrImageImportResult
}

internal enum class QrImageImportError {
    NO_QR_CODE,
    MULTIPLE_QR_CODES,
    BLANK_RAW_VALUE,
    IMAGE_DECODE_FAILURE,
    INVALID_PAYLOAD,
}

internal sealed interface QrImageImportHandling {
    data object Cancelled : QrImageImportHandling
    data object Accepted : QrImageImportHandling
    data class Failed(val error: QrImageImportError) : QrImageImportHandling
}

internal enum class QrImageBitmapSource {
    SYSTEM_THUMBNAIL,
    DIRECT_DECODE,
}

internal fun shouldApplySourceExifOrientation(source: QrImageBitmapSource): Boolean =
    source == QrImageBitmapSource.DIRECT_DECODE

/**
 * Converts the bounded QR decoder result into a single image-import outcome.
 * Payload parsing intentionally remains outside this boundary.
 */
internal fun classifyQrImageResults(rawValues: List<String?>): QrImageImportResult = when {
    rawValues.isEmpty() -> QrImageImportResult.NoQrCode
    rawValues.size > 1 -> QrImageImportResult.MultipleQrCodes
    else -> rawValues.single()?.takeIf(String::isNotBlank)?.let(QrImageImportResult::Payload)
        ?: QrImageImportResult.BlankRawValue
}

/**
 * Hands the one extracted raw value to the existing pairing callback exactly
 * as camera acquisition does. No Metrora payload validation belongs here.
 */
internal fun handoffQrImageResult(
    result: QrImageImportResult,
    onPayload: (String) -> Boolean,
): QrImageImportHandling = when (result) {
    QrImageImportResult.Cancelled -> QrImageImportHandling.Cancelled
    QrImageImportResult.NoQrCode -> QrImageImportHandling.Failed(QrImageImportError.NO_QR_CODE)
    QrImageImportResult.MultipleQrCodes -> QrImageImportHandling.Failed(QrImageImportError.MULTIPLE_QR_CODES)
    QrImageImportResult.BlankRawValue -> QrImageImportHandling.Failed(QrImageImportError.BLANK_RAW_VALUE)
    QrImageImportResult.ImageDecodeFailure -> QrImageImportHandling.Failed(QrImageImportError.IMAGE_DECODE_FAILURE)
    is QrImageImportResult.Payload -> if (onPayload(result.rawValue)) {
        QrImageImportHandling.Accepted
    } else {
        QrImageImportHandling.Failed(QrImageImportError.INVALID_PAYLOAD)
    }
}

/**
 * A single decode operation owns its callback delivery. Cancelling it also
 * invalidates any result already queued on the main executor.
 */
internal class QrImageDecodeOperation internal constructor() {
    private val active = AtomicBoolean(true)

    internal fun cancel() {
        active.set(false)
    }

    internal fun isActive(): Boolean = active.get()

    internal fun tryDeliver(): Boolean = active.compareAndSet(true, false)
}

/**
 * Local, QR-only static-image decoder. The source bitmap is downsampled and
 * released after ZXing finishes; the selected Uri is never copied or stored.
 */
internal class QrImageDecoder(context: Context) : Closeable {
    private val applicationContext = context.applicationContext
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private val callbackExecutor = ContextCompat.getMainExecutor(applicationContext)
    private val closed = AtomicBoolean(false)

    internal fun decode(
        uri: Uri,
        onResult: (QrImageImportResult) -> Unit,
    ): QrImageDecodeOperation {
        val operation = QrImageDecodeOperation()
        if (closed.get()) {
            operation.cancel()
            return operation
        }

        try {
            worker.execute {
                decodeOnWorker(uri, operation, onResult)
            }
        } catch (_: RejectedExecutionException) {
            operation.cancel()
        }
        return operation
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        worker.shutdownNow()
    }

    private fun decodeOnWorker(
        uri: Uri,
        operation: QrImageDecodeOperation,
        onResult: (QrImageImportResult) -> Unit,
    ) {
        var bitmap: Bitmap? = null
        try {
            if (!operation.isActive()) return
            val decodedBitmap = readBoundedBitmap(applicationContext.contentResolver, uri)
            bitmap = decodedBitmap
            if (!operation.isActive()) return

            val pixels = IntArray(decodedBitmap.width * decodedBitmap.height)
            decodedBitmap.getPixels(
                pixels,
                0,
                decodedBitmap.width,
                0,
                0,
                decodedBitmap.width,
                decodedBitmap.height,
            )
            deliver(
                operation = operation,
                result = classifyQrImageResults(
                    decodeQrBitmapPixels(decodedBitmap.width, decodedBitmap.height, pixels),
                ),
                onResult = onResult,
            )
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (_: Exception) {
            deliver(operation, QrImageImportResult.ImageDecodeFailure, onResult)
        } catch (_: OutOfMemoryError) {
            deliver(operation, QrImageImportResult.ImageDecodeFailure, onResult)
        } finally {
            bitmap?.let { decoded ->
                if (!decoded.isRecycled) decoded.recycle()
            }
        }
    }

    private fun deliver(
        operation: QrImageDecodeOperation,
        result: QrImageImportResult,
        onResult: (QrImageImportResult) -> Unit,
    ) {
        try {
            callbackExecutor.execute {
                if (operation.tryDeliver()) onResult(result)
            }
        } catch (_: RejectedExecutionException) {
            operation.cancel()
        }
    }

    private fun readBoundedBitmap(contentResolver: ContentResolver, uri: Uri): Bitmap {
        val thumbnail = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            runCatching {
                contentResolver.loadThumbnail(
                    uri,
                    Size(MAX_IMAGE_DIMENSION.toInt(), MAX_IMAGE_DIMENSION.toInt()),
                    null,
                )
            }.getOrNull()
        } else {
            null
        }
        if (thumbnail != null) {
            val bounded = enforceBitmapBounds(thumbnail)
            return orientBitmapForSource(
                contentResolver = contentResolver,
                uri = uri,
                bitmap = bounded,
                source = QrImageBitmapSource.SYSTEM_THUMBNAIL,
            )
        }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        decodeBitmap(contentResolver, uri, bounds)

        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Image content is unreadable" }

        val options = BitmapFactory.Options().apply {
            inSampleSize = calculateSampleSize(bounds.outWidth, bounds.outHeight)
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inScaled = false
        }
        val decoded = decodeBitmap(contentResolver, uri, options)
            ?: throw IllegalArgumentException("Image content is unavailable or unreadable")
        val bounded = enforceBitmapBounds(decoded)
        val oriented = orientBitmapForSource(
            contentResolver = contentResolver,
            uri = uri,
            bitmap = bounded,
            source = QrImageBitmapSource.DIRECT_DECODE,
        )
        return enforceBitmapBounds(oriented)
    }

    private fun orientBitmapForSource(
        contentResolver: ContentResolver,
        uri: Uri,
        bitmap: Bitmap,
        source: QrImageBitmapSource,
    ): Bitmap {
        if (!shouldApplySourceExifOrientation(source)) return bitmap
        return applyExifOrientation(contentResolver, uri, bitmap)
    }

    private fun applyExifOrientation(
        contentResolver: ContentResolver,
        uri: Uri,
        bitmap: Bitmap,
    ): Bitmap {
        val orientation = readExifOrientation(contentResolver, uri)
            ?: ExifInterface.ORIENTATION_NORMAL

        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(270f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
            else -> return bitmap
        }

        val transformed = Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            matrix,
            true,
        )
        if (transformed !== bitmap) bitmap.recycle()
        return transformed
    }

    private fun decodeBitmap(
        contentResolver: ContentResolver,
        uri: Uri,
        options: BitmapFactory.Options,
    ): Bitmap? {
        val descriptorBitmap = runCatching {
            contentResolver.openFileDescriptor(uri, "r")?.use { descriptor ->
                BitmapFactory.decodeFileDescriptor(descriptor.fileDescriptor, null, options)
            }
        }.getOrNull()
        if (descriptorBitmap != null) return descriptorBitmap

        return runCatching {
            contentResolver.openInputStream(uri)?.use { input ->
                BitmapFactory.decodeStream(input, null, options)
            }
        }.getOrNull()
    }

    private fun readExifOrientation(
        contentResolver: ContentResolver,
        uri: Uri,
    ): Int? {
        val descriptorOrientation = runCatching {
            contentResolver.openFileDescriptor(uri, "r")?.use { descriptor ->
                ExifInterface(descriptor.fileDescriptor).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL,
                )
            }
        }.getOrNull()
        if (descriptorOrientation != null) return descriptorOrientation

        return runCatching {
            contentResolver.openInputStream(uri)?.use { input ->
                ExifInterface(input).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL,
                )
            }
        }.getOrNull()
    }

    private fun enforceBitmapBounds(bitmap: Bitmap): Bitmap {
        val pixels = bitmap.width.toLong() * bitmap.height.toLong()
        if (bitmap.width > MAX_IMAGE_DIMENSION ||
            bitmap.height > MAX_IMAGE_DIMENSION ||
            pixels > MAX_IMAGE_PIXELS
        ) {
            bitmap.recycle()
            throw IllegalArgumentException("Image content exceeds the bounded decode size")
        }
        return bitmap
    }

    private fun calculateSampleSize(width: Int, height: Int): Int {
        var sample = 1
        while (scaledDimension(width, sample) > MAX_IMAGE_DIMENSION ||
            scaledDimension(height, sample) > MAX_IMAGE_DIMENSION ||
            scaledDimension(width, sample) * scaledDimension(height, sample) > MAX_IMAGE_PIXELS
        ) {
            sample *= 2
        }
        return sample
    }

    private fun scaledDimension(dimension: Int, sample: Int): Long =
        (dimension.toLong() + sample.toLong() - 1L) / sample.toLong()

    private companion object {
        const val MAX_IMAGE_DIMENSION = 2_048L
        const val MAX_IMAGE_PIXELS = 4_000_000L
    }
}
