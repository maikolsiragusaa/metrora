package eu.metrora.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.widthIn
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraCoordinator
import eu.metrora.app.MetroraFailureReason
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.network.MetroraProtocol

private val PairingPagePadding = 19.dp

@Composable
internal fun ConnectScreen(
    state: MetroraUiState,
    coordinator: MetroraCoordinator,
    onOpenScanner: () -> Unit,
    onOpenManual: () -> Unit,
    onExploreDemo: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 10.dp)
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PairingPagePadding, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        MetroraBrandHeader()
        Spacer(Modifier.height(8.dp))
        Feedback(state)
        PairingIntro(R.string.connect_title, R.string.connect_body, bodyWidth = 200.dp)
        ConnectQrCard(enabled = !state.busy, onClick = onOpenScanner)
        PairingOrDivider()
        MetroraPanel(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = !state.busy, role = Role.Button, onClick = onOpenManual),
            color = MetroraPalette.surface.copy(alpha = 0.82f),
            radius = 16,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                MetroraIconBadge(Icons.Outlined.DesktopWindows, tint = MetroraPalette.cyan, size = 24.dp)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        androidx.compose.ui.res.stringResource(R.string.manual_address_title),
                        style = MaterialTheme.typography.titleMedium.copy(fontSize = 12.sp, lineHeight = 16.sp),
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        androidx.compose.ui.res.stringResource(R.string.manual_address_fallback_body),
                        style = MaterialTheme.typography.labelMedium.copy(fontSize = 9.sp, lineHeight = 12.sp, letterSpacing = 0.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        DemoExploreCard(enabled = !state.busy, onClick = onExploreDemo)
        LocalPrivateCard(modifier = Modifier.padding(top = 3.dp))
        HowItWorksCard(modifier = Modifier.padding(top = 3.dp))
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.pairing_footer),
            modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun DemoExploreCard(enabled: Boolean, onClick: () -> Unit) {
    val actionDescription = androidx.compose.ui.res.stringResource(R.string.explore_demo_action)
    MetroraPanel(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = actionDescription },
        color = MetroraPalette.surface.copy(alpha = 0.68f),
        borderColor = MetroraPalette.cyan.copy(alpha = 0.34f),
        radius = 16,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            MetroraIconBadge(Icons.Outlined.Info, tint = MetroraPalette.cyan, size = 24.dp)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    androidx.compose.ui.res.stringResource(R.string.explore_demo_action),
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 12.sp, lineHeight = 16.sp),
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    androidx.compose.ui.res.stringResource(R.string.explore_demo_body),
                    style = MaterialTheme.typography.labelMedium.copy(fontSize = 9.sp, lineHeight = 12.sp, letterSpacing = 0.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun ManualConnectionScreen(
    state: MetroraUiState,
    coordinator: MetroraCoordinator,
    onBack: () -> Unit,
    onOpenScanner: () -> Unit,
) {
    var host by rememberSaveable { mutableStateOf("") }
    var port by rememberSaveable { mutableStateOf(MetroraProtocol.DEFAULT_PORT.toString()) }
    val focusManager = LocalFocusManager.current
    val invalidHost = state.failure?.reason == MetroraFailureReason.INVALID_HOST
    val invalidPort = state.failure?.reason == MetroraFailureReason.INVALID_PORT
    val canSubmit = !state.busy && host.isNotBlank() && port.isNotBlank()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 10.dp)
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PairingPagePadding, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        MetroraBackHeader(onBack = onBack)
            Spacer(Modifier.height(5.dp))
        PairingIntro(
            R.string.manual_address_title,
            R.string.manual_address_body,
            bodySpacing = 11.dp,
            bodyBottomPadding = 8.dp,
        )
        Feedback(state)
        MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.82f), radius = 18) {
            Column(modifier = Modifier.padding(horizontal = 23.dp, vertical = 21.5.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(androidx.compose.ui.res.stringResource(R.string.desktop_address), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                OutlinedTextField(
                    value = host,
                    onValueChange = { host = it },
                    modifier = Modifier.fillMaxWidth().height(43.dp),
                    enabled = !state.busy,
                    singleLine = true,
                    isError = invalidHost,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                )
                Text(
                    androidx.compose.ui.res.stringResource(if (invalidHost) failureResource(state.failure) else R.string.desktop_address_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (invalidHost) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(androidx.compose.ui.res.stringResource(R.string.port), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                OutlinedTextField(
                    value = port,
                    onValueChange = { port = it.filter(Char::isDigit).take(5) },
                    modifier = Modifier.fillMaxWidth().height(43.dp),
                    enabled = !state.busy,
                    singleLine = true,
                    isError = invalidPort,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = {
                        if (canSubmit) {
                            focusManager.clearFocus()
                            coordinator.pair(host, port)
                        }
                    }),
                )
                Text(
                    androidx.compose.ui.res.stringResource(if (invalidPort) failureResource(state.failure) else R.string.port_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (invalidPort) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (state.status == MetroraConnectionState.PAIRING) {
            Row(modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text(androidx.compose.ui.res.stringResource(R.string.pairing_discovering), style = MaterialTheme.typography.bodyMedium)
            }
        } else {
            MetroraPrimaryButton(
                text = androidx.compose.ui.res.stringResource(R.string.pair_action),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                enabled = canSubmit,
                onClick = { coordinator.pair(host, port) },
            )
        }
        TextButton(
            onClick = onOpenScanner,
            modifier = Modifier.fillMaxWidth().height(44.dp).offset(y = (-8).dp),
            contentPadding = PaddingValues(0.dp),
        ) {
            Text(androidx.compose.ui.res.stringResource(R.string.scan_qr_instead))
        }
        LocalPrivateCard(compact = false, modifier = Modifier.offset(y = (-18).dp))
    }
}

@Composable
private fun PairingIntro(
    title: Int,
    body: Int,
    bodySpacing: androidx.compose.ui.unit.Dp = 6.dp,
    bodyWidth: androidx.compose.ui.unit.Dp = 230.dp,
    bodyBottomPadding: androidx.compose.ui.unit.Dp = 0.dp,
) {
    Column(
        modifier = Modifier.padding(bottom = bodyBottomPadding),
        verticalArrangement = Arrangement.spacedBy(bodySpacing),
    ) {
        Text(androidx.compose.ui.res.stringResource(title), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold)
        Text(
            androidx.compose.ui.res.stringResource(body),
            modifier = Modifier.widthIn(max = bodyWidth),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ConnectQrCard(enabled: Boolean, onClick: () -> Unit) {
    val action = androidx.compose.ui.res.stringResource(R.string.scan_qr_action)
    MetroraPanel(
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = action },
        color = MetroraPalette.surfaceRaised,
        borderColor = MetroraPalette.cyan,
        radius = 18,
    ) {
        Row(modifier = Modifier.padding(horizontal = 28.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Surface(modifier = Modifier.size(104.dp), shape = RoundedCornerShape(18.dp), color = Color.Transparent) {
                    DecorativeQrMark()
                }
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(androidx.compose.ui.res.stringResource(R.string.scan_qr_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Surface(shape = RoundedCornerShape(8.dp), color = Color.Transparent, border = androidx.compose.foundation.BorderStroke(1.dp, MetroraPalette.cyan.copy(alpha = 0.7f))) {
                    Text(androidx.compose.ui.res.stringResource(R.string.recommended), color = MetroraPalette.cyan, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                }
            }
        }
    }
}

@Composable
private fun PairingOrDivider() {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        HorizontalDivider(Modifier.weight(1f), color = MetroraPalette.borderStrong.copy(alpha = 0.55f))
        Text(androidx.compose.ui.res.stringResource(R.string.or_label), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
        HorizontalDivider(Modifier.weight(1f), color = MetroraPalette.borderStrong.copy(alpha = 0.55f))
    }
}

@Composable
private fun DecorativeQrMark(modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxSize()) {
        val cell = size.minDimension / 22f
        val origin = cell * 5f
        val color = MetroraPalette.cyan
        for (x in 2..19) for (y in 2..19) {
            drawCircle(color.copy(alpha = 0.10f), radius = cell * 0.08f, center = androidx.compose.ui.geometry.Offset((x + 0.5f) * cell, (y + 0.5f) * cell))
        }
        fun block(x: Int, y: Int, w: Int = 1, h: Int = 1) {
            drawRect(color, topLeft = androidx.compose.ui.geometry.Offset(origin + x * cell, origin + y * cell), size = androidx.compose.ui.geometry.Size(w * cell, h * cell))
        }
        fun finder(x: Int, y: Int) {
            block(x, y, 5, 1); block(x, y + 4, 5, 1); block(x, y, 1, 5); block(x + 4, y, 1, 5); block(x + 2, y + 2, 1, 1)
        }
        finder(0, 0)
        finder(6, 0)
        finder(0, 6)
        listOf(6 to 6, 8 to 6, 5 to 8, 7 to 8, 9 to 8, 6 to 10, 8 to 10, 10 to 10, 5 to 4, 7 to 3, 9 to 4, 4 to 7, 4 to 9, 2 to 6, 6 to 5).forEach { (x, y) -> block(x, y) }
        val frame = color.copy(alpha = 0.72f)
        val corner = cell * 2f
        val inset = cell * 1.75f
        drawLine(frame, androidx.compose.ui.geometry.Offset(inset, inset + corner), androidx.compose.ui.geometry.Offset(inset, inset), strokeWidth = 2.dp.toPx())
        drawLine(frame, androidx.compose.ui.geometry.Offset(inset, inset), androidx.compose.ui.geometry.Offset(inset + corner, inset), strokeWidth = 2.dp.toPx())
        drawLine(frame, androidx.compose.ui.geometry.Offset(size.width - inset - corner, inset), androidx.compose.ui.geometry.Offset(size.width - inset, inset), strokeWidth = 2.dp.toPx())
        drawLine(frame, androidx.compose.ui.geometry.Offset(size.width - inset, inset), androidx.compose.ui.geometry.Offset(size.width - inset, inset + corner), strokeWidth = 2.dp.toPx())
        drawLine(frame, androidx.compose.ui.geometry.Offset(inset, size.height - inset - corner), androidx.compose.ui.geometry.Offset(inset, size.height - inset), strokeWidth = 2.dp.toPx())
        drawLine(frame, androidx.compose.ui.geometry.Offset(inset, size.height - inset), androidx.compose.ui.geometry.Offset(inset + corner, size.height - inset), strokeWidth = 2.dp.toPx())
        drawLine(frame, androidx.compose.ui.geometry.Offset(size.width - inset - corner, size.height - inset), androidx.compose.ui.geometry.Offset(size.width - inset, size.height - inset), strokeWidth = 2.dp.toPx())
        drawLine(frame, androidx.compose.ui.geometry.Offset(size.width - inset, size.height - inset - corner), androidx.compose.ui.geometry.Offset(size.width - inset, size.height - inset), strokeWidth = 2.dp.toPx())
    }
}

@Composable
private fun LocalPrivateCard(modifier: Modifier = Modifier, compact: Boolean = true) {
    MetroraPanel(modifier = modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.76f), radius = if (compact) 14 else 16) {
        Row(modifier = Modifier.padding(horizontal = 20.dp, vertical = if (compact) 5.dp else 18.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            MetroraIconBadge(Icons.Outlined.Lock, tint = MetroraPalette.cyan, size = 22.dp)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(androidx.compose.ui.res.stringResource(R.string.local_private_title), style = MaterialTheme.typography.titleMedium.copy(fontSize = 12.sp, lineHeight = 16.sp), fontWeight = FontWeight.SemiBold)
                Text(androidx.compose.ui.res.stringResource(R.string.local_private_body), style = if (compact) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun HowItWorksCard(modifier: Modifier = Modifier) {
    MetroraPanel(modifier = modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.76f), radius = 18) {
        Column(modifier = Modifier.padding(start = 14.dp, top = 12.dp, end = 14.dp, bottom = 9.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.how_it_works_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            PairingStep(1, Icons.Outlined.DesktopWindows, R.string.how_it_works_step_one, R.string.how_it_works_step_one_body)
            PairingStep(2, Icons.Outlined.QrCode2, R.string.how_it_works_step_two, R.string.how_it_works_step_two_body)
            PairingStep(3, Icons.Outlined.Security, R.string.how_it_works_step_three, R.string.how_it_works_step_three_body)
        }
    }
}

@Composable
private fun PairingStep(step: Int, icon: androidx.compose.ui.graphics.vector.ImageVector, title: Int, body: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.Top) {
        MetroraIconBadge(icon, tint = MetroraPalette.cyan, size = 24.dp)
        Surface(modifier = Modifier.size(22.dp), shape = RoundedCornerShape(50), color = MetroraPalette.surfaceMuted) {
            Text(step.toString(), modifier = Modifier.fillMaxSize(), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(androidx.compose.ui.res.stringResource(title), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(androidx.compose.ui.res.stringResource(body), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun VerifySasScreen(state: MetroraUiState, onConfirm: () -> Unit, onCancel: () -> Unit) {
    val code = state.pairingCode ?: return
    val waiting = state.status == MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL
    val codeA11y = androidx.compose.ui.res.stringResource(R.string.confirmation_code_a11y, code)
    Column(
        modifier = Modifier.fillMaxSize().padding(top = 10.dp).navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = PairingPagePadding, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        MetroraBackHeader(onBack = onCancel)
        PairingIntro(
            R.string.verify_title,
            R.string.verify_body,
            bodySpacing = 9.dp,
            bodyBottomPadding = 3.dp,
        )
        Feedback(state)
        MetroraPanel(
            modifier = Modifier.fillMaxWidth().padding(top = 2.dp).semantics { liveRegion = LiveRegionMode.Polite; contentDescription = codeA11y },
            color = MetroraPalette.surfaceRaised,
            borderColor = MetroraPalette.borderStrong,
            radius = 20,
        ) {
            Column(modifier = Modifier.padding(horizontal = 24.dp, vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(7.dp)) {
                VerifiedShieldIcon(Modifier.size(46.dp))
                SelectionContainer {
                    Text(code.chunked(3).joinToString("  "), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.displayMedium.copy(fontSize = 46.sp, lineHeight = 54.sp, letterSpacing = 2.sp), textAlign = TextAlign.Center)
                }
                Text(androidx.compose.ui.res.stringResource(R.string.pairing_code_label), color = MetroraPalette.cyan, style = MaterialTheme.typography.labelMedium, letterSpacing = 3.sp)
                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp), color = MetroraPalette.border.copy(alpha = 0.7f))
                RuntimePairingRow(Icons.Outlined.DesktopWindows, state.pairingDesktopName ?: androidx.compose.ui.res.stringResource(R.string.desktop_label), R.string.computer_name_label)
                HorizontalDivider(color = MetroraPalette.border.copy(alpha = 0.65f))
                RuntimePairingRow(Icons.Outlined.Timer, if (waiting) androidx.compose.ui.res.stringResource(R.string.waiting_for_desktop) else androidx.compose.ui.res.stringResource(R.string.verify_approval_title), R.string.verify_approval_hint)
            }
        }
        MetroraPanel(modifier = Modifier.fillMaxWidth().padding(top = 6.dp, start = 30.dp, end = 30.dp), color = MetroraPalette.surface.copy(alpha = 0.72f), radius = 14) {
            Row(modifier = Modifier.padding(horizontal = 10.dp, vertical = 11.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                Icon(Icons.Outlined.Security, contentDescription = null, tint = MetroraPalette.cyan, modifier = Modifier.size(24.dp))
                Text(androidx.compose.ui.res.stringResource(R.string.verify_security_body), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp, lineHeight = 14.sp, letterSpacing = 0.sp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (waiting) {
            Row(modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text(androidx.compose.ui.res.stringResource(R.string.waiting_for_desktop), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            MetroraPrimaryButton(text = androidx.compose.ui.res.stringResource(R.string.codes_match), modifier = Modifier.fillMaxWidth().padding(top = 9.dp), leadingContent = { VerifiedShieldIcon(Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onPrimary) }, onClick = onConfirm)
        }
        TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).offset(y = (-6).dp), contentPadding = PaddingValues(vertical = 8.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.cancel_pairing_action))
        }
    }
}

@Composable
private fun RuntimePairingRow(icon: androidx.compose.ui.graphics.vector.ImageVector, value: String, label: Int) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(17.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MetroraPalette.cyan, modifier = Modifier.size(26.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(value, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(androidx.compose.ui.res.stringResource(label), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun VerifiedShieldIcon(modifier: Modifier = Modifier, tint: Color = MetroraPalette.cyan) {
    androidx.compose.foundation.layout.Box(modifier, contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.Shield, contentDescription = null, tint = tint, modifier = Modifier.fillMaxSize())
        Icon(Icons.Outlined.Check, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
    }
}

@Composable
internal fun ConnectedSuccessScreen(state: MetroraUiState, onOpenHome: () -> Unit) {
    val credentials = state.credentials ?: return
    Column(
        modifier = Modifier.fillMaxSize().padding(top = 10.dp).navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = PairingPagePadding, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        MetroraLogo(compact = false, modifier = Modifier.padding(top = 13.dp))
        Spacer(Modifier.height(10.dp))
        Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MetroraPalette.cyan, modifier = Modifier.size(112.dp).padding(top = 11.dp))
        Text(androidx.compose.ui.res.stringResource(R.string.connected_success_title), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(
            androidx.compose.ui.res.stringResource(R.string.connected_success_body),
            modifier = Modifier.widthIn(max = 280.dp).padding(bottom = 3.dp),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        MetroraPanel(modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp), color = MetroraPalette.surfaceRaised, borderColor = MetroraPalette.borderStrong, radius = 20) {
            Column(modifier = Modifier.padding(start = 23.dp, top = 7.dp, end = 23.dp, bottom = 2.dp)) {
                val facts = listOf(
                    Triple(Icons.Outlined.DesktopWindows, R.string.success_computer, credentials.desktopName),
                    Triple(Icons.Outlined.Shield, R.string.success_pairing, androidx.compose.ui.res.stringResource(R.string.verified)),
                    Triple(Icons.Outlined.Lock, R.string.success_mode, androidx.compose.ui.res.stringResource(R.string.local_private_short)),
                    Triple(Icons.Outlined.Check, R.string.success_relay, androidx.compose.ui.res.stringResource(R.string.none_value)),
                )
                facts.forEachIndexed { index, (icon, label, value) ->
                    SuccessFact(icon, label, value)
                    if (index != facts.lastIndex) HorizontalDivider(color = MetroraPalette.border.copy(alpha = 0.68f))
                }
            }
        }
        MetroraPrimaryButton(text = androidx.compose.ui.res.stringResource(R.string.open_home), modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(top = 9.dp), onClick = onOpenHome)
    }
}

@Composable
private fun SuccessFact(icon: androidx.compose.ui.graphics.vector.ImageVector, label: Int, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MetroraPalette.cyan, modifier = Modifier.size(28.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(androidx.compose.ui.res.stringResource(label), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
internal fun InitializingState() {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surfaceRaised) {
        Row(modifier = Modifier.padding(20.dp), horizontalArrangement = Arrangement.spacedBy(13.dp), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.5.dp)
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(androidx.compose.ui.res.stringResource(R.string.initializing_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(androidx.compose.ui.res.stringResource(R.string.initializing_body), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
internal fun RecoveryState(onForget: () -> Unit) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.72f), borderColor = MaterialTheme.colorScheme.error.copy(alpha = 0.65f)) {
        Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 22.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Icon(Icons.Outlined.WarningAmber, contentDescription = androidx.compose.ui.res.stringResource(R.string.recovery_icon), tint = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.size(28.dp))
            Text(androidx.compose.ui.res.stringResource(R.string.status_recovery_required), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onErrorContainer)
            Text(androidx.compose.ui.res.stringResource(R.string.status_recovery_body), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
            OutlinedButton(onClick = onForget, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
                Text(androidx.compose.ui.res.stringResource(R.string.pair_again))
            }
        }
    }
}
