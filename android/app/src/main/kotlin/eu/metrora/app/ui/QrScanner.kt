package eu.metrora.app.ui

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.PickVisualMediaRequest
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.widthIn
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import eu.metrora.app.R
import java.util.concurrent.Executors

@Composable
internal fun QrScannerScreen(
    onBack: () -> Unit,
    onManual: () -> Unit,
    onPayload: (String) -> Boolean,
) {
    val context = LocalContext.current
    val activity = context as? Activity
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var scannerError by remember { mutableStateOf<QrScannerError?>(null) }
    var imageDecodeOperation by remember { mutableStateOf<QrImageDecodeOperation?>(null) }
    val requestPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> hasPermission = granted }
    val latestOnPayload = rememberUpdatedState(onPayload)
    val imageDecoder = remember(context) { QrImageDecoder(context) }
    val latestImageDecodeOperation = rememberUpdatedState(imageDecodeOperation)
    val pickImage = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        if (uri != null) {
            imageDecodeOperation?.cancel()
            scannerError = null
            val operation = imageDecoder.decode(uri) { result ->
                imageDecodeOperation = null
                when (val handling = handoffQrImageResult(result, latestOnPayload.value)) {
                    QrImageImportHandling.Cancelled -> Unit
                    QrImageImportHandling.Accepted -> scannerError = null
                    is QrImageImportHandling.Failed -> {
                        scannerError = when (handling.error) {
                            QrImageImportError.INVALID_PAYLOAD -> QrScannerError.INVALID_PAYLOAD
                            QrImageImportError.NO_QR_CODE -> QrScannerError.NO_QR_CODE
                            QrImageImportError.MULTIPLE_QR_CODES -> QrScannerError.MULTIPLE_QR_CODES
                            QrImageImportError.BLANK_RAW_VALUE,
                            QrImageImportError.IMAGE_DECODE_FAILURE,
                            -> QrScannerError.IMAGE_READ_FAILURE
                        }
                    }
                }
            }
            imageDecodeOperation = operation
        }
    }

    LaunchedEffect(Unit) {
        if (!hasPermission && activity?.shouldShowRequestPermissionRationale(Manifest.permission.CAMERA) == false) {
            requestPermission.launch(Manifest.permission.CAMERA)
        }
    }

    DisposableEffect(imageDecoder) {
        onDispose {
            latestImageDecodeOperation.value?.cancel()
            imageDecoder.close()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 10.dp)
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 19.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        MetroraBackHeader(onBack = onBack)
        Column(
            modifier = Modifier.padding(bottom = 2.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.scan_qr_title),
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.scan_qr_body),
                modifier = Modifier.widthIn(max = 230.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        MetroraPanel(
            modifier = Modifier.fillMaxWidth().height(254.dp),
            color = MetroraPalette.background,
            borderColor = MetroraPalette.borderStrong,
            radius = 20,
        ) {
            Box(Modifier.fillMaxSize()) {
                if (hasPermission) {
                    QrCameraPreview(
                        onDetected = { raw ->
                            scannerError = if (onPayload(raw)) null else QrScannerError.INVALID_PAYLOAD
                        },
                    )
                    ScannerAmbientGlow(Modifier.fillMaxSize())
                    ScannerCorners(Modifier.fillMaxSize())
                } else {
                    CameraPermissionPrompt(onRequest = {
                        requestPermission.launch(Manifest.permission.CAMERA)
                    })
                }
            }
        }

        OutlinedButton(
            onClick = {
                imageDecodeOperation?.cancel()
                imageDecodeOperation = null
                scannerError = null
                pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Icon(imageVector = Icons.Outlined.PhotoLibrary, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(androidx.compose.ui.res.stringResource(R.string.import_qr_from_image))
        }

        val errorMessage = when (scannerError) {
            null -> null
            QrScannerError.INVALID_PAYLOAD -> R.string.qr_invalid_payload
            QrScannerError.NO_QR_CODE -> R.string.qr_no_code_in_image
            QrScannerError.MULTIPLE_QR_CODES -> R.string.qr_multiple_codes_in_image
            QrScannerError.IMAGE_READ_FAILURE -> R.string.qr_image_read_failed
        }
        if (errorMessage != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { liveRegion = LiveRegionMode.Polite },
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.ErrorOutline,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                )
                Text(
                    text = androidx.compose.ui.res.stringResource(errorMessage),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 5.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.QrCodeScanner,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.qr_scanner_local_only),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        MetroraPanel(
            modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.22f),
            radius = 18,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(22.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Box(Modifier.size(34.dp), contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Outlined.Shield,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.fillMaxSize(),
                    )
                    Icon(
                        imageVector = Icons.Outlined.CameraAlt,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(14.dp).padding(top = 1.dp),
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.qr_same_network_title),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.qr_same_network_body),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        TextButton(
            onClick = onManual,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).offset(y = (-6).dp),
        ) {
            Text(androidx.compose.ui.res.stringResource(R.string.manual_address_action))
        }
    }
}

private enum class QrScannerError {
    INVALID_PAYLOAD,
    NO_QR_CODE,
    MULTIPLE_QR_CODES,
    IMAGE_READ_FAILURE,
}

@Composable
private fun CameraPermissionPrompt(onRequest: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Outlined.CameraAlt,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.height(14.dp))
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.camera_permission_title),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.camera_permission_body),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(14.dp))
        Button(onClick = onRequest, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.allow_camera))
        }
    }
}

@Composable
private fun ScannerCorners(modifier: Modifier) {
    val cyan = MaterialTheme.colorScheme.primary
    Canvas(modifier.padding(35.dp)) {
        val length = 22.dp.toPx()
        val stroke = 3.dp.toPx()
        val cap = StrokeCap.Round
        drawLine(cyan, androidx.compose.ui.geometry.Offset(0f, length), androidx.compose.ui.geometry.Offset(0f, 0f), stroke, cap)
        drawLine(cyan, androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Offset(length, 0f), stroke, cap)
        drawLine(cyan, androidx.compose.ui.geometry.Offset(size.width - length, 0f), androidx.compose.ui.geometry.Offset(size.width, 0f), stroke, cap)
        drawLine(cyan, androidx.compose.ui.geometry.Offset(size.width, 0f), androidx.compose.ui.geometry.Offset(size.width, length), stroke, cap)
        drawLine(cyan, androidx.compose.ui.geometry.Offset(0f, size.height - length), androidx.compose.ui.geometry.Offset(0f, size.height), stroke, cap)
        drawLine(cyan, androidx.compose.ui.geometry.Offset(0f, size.height), androidx.compose.ui.geometry.Offset(length, size.height), stroke, cap)
        drawLine(cyan, androidx.compose.ui.geometry.Offset(size.width - length, size.height), androidx.compose.ui.geometry.Offset(size.width, size.height), stroke, cap)
        drawLine(cyan, androidx.compose.ui.geometry.Offset(size.width, size.height - length), androidx.compose.ui.geometry.Offset(size.width, size.height), stroke, cap)
    }
}

@Composable
private fun ScannerAmbientGlow(modifier: Modifier) {
    Canvas(modifier) {
        drawRect(
            brush = Brush.verticalGradient(
                colors = listOf(
                    Color.Transparent,
                    MetroraPalette.surfaceRaised.copy(alpha = 0.14f),
                    MetroraPalette.cyan.copy(alpha = 0.16f),
                ),
            ),
        )
        drawCircle(
            color = MetroraPalette.cyan.copy(alpha = 0.09f),
            radius = size.width * 0.28f,
            center = androidx.compose.ui.geometry.Offset(size.width / 2f, size.height * 1.03f),
        )
    }
}

@Composable
@androidx.annotation.OptIn(markerClass = [ExperimentalGetImage::class])
private fun QrCameraPreview(onDetected: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val latestOnDetected by rememberUpdatedState(onDetected)
    val previewView = remember { PreviewView(context) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build(),
        )
    }

    DisposableEffect(lifecycleOwner) {
        var cameraProvider: ProcessCameraProvider? = null
        val providerFuture = ProcessCameraProvider.getInstance(context)
        val listener = Runnable {
            cameraProvider = providerFuture.get()
            val preview = Preview.Builder().build().also {
                it.surfaceProvider = previewView.surfaceProvider
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analysis.setAnalyzer(executor) { imageProxy ->
                val mediaImage = imageProxy.image
                if (mediaImage == null) {
                    imageProxy.close()
                } else {
                    scanner.process(
                        InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees),
                    ).addOnSuccessListener { codes ->
                        codes.firstOrNull()?.rawValue?.let(latestOnDetected)
                    }.addOnCompleteListener {
                        imageProxy.close()
                    }
                }
            }
            runCatching {
                cameraProvider?.unbindAll()
                cameraProvider?.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
            }
        }
        providerFuture.addListener(listener, ContextCompat.getMainExecutor(context))
        onDispose {
            cameraProvider?.unbindAll()
            scanner.close()
            executor.shutdown()
        }
    }

    androidx.compose.ui.viewinterop.AndroidView(
        factory = { previewView },
        modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(21.dp)),
    )
}
