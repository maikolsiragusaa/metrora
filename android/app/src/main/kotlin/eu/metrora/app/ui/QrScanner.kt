package eu.metrora.app.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
    onPayload: (String) -> Boolean,
) {
    val context = LocalContext.current
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var invalidPayload by remember { mutableStateOf(false) }
    val requestPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> hasPermission = granted }

    LaunchedEffect(Unit) {
        if (!hasPermission) requestPermission.launch(Manifest.permission.CAMERA)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        MetroraBackHeader(onBack = onBack, onHelp = {})
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.scan_qr_title),
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.scan_qr_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        MetroraPanel(
            modifier = Modifier.fillMaxWidth().height(334.dp),
            color = Color.Black,
            borderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.75f),
            radius = 22,
        ) {
            Box(Modifier.fillMaxSize()) {
                if (hasPermission) {
                    QrCameraPreview(
                        onDetected = { raw ->
                            invalidPayload = !onPayload(raw)
                        },
                    )
                    ScannerCorners(Modifier.fillMaxSize())
                } else {
                    CameraPermissionPrompt(onRequest = {
                        requestPermission.launch(Manifest.permission.CAMERA)
                    })
                }
            }
        }

        if (invalidPayload) {
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
                    text = androidx.compose.ui.res.stringResource(R.string.qr_invalid_payload),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
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
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.22f),
            radius = 18,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    imageVector = Icons.Outlined.CameraAlt,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(30.dp),
                )
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.qr_same_network_title),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.qr_same_network_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        TextButton(
            onClick = onBack,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Text(androidx.compose.ui.res.stringResource(R.string.manual_address_action))
        }
    }
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
    Canvas(modifier.padding(30.dp)) {
        val length = 42.dp.toPx()
        val stroke = 4.dp.toPx()
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
