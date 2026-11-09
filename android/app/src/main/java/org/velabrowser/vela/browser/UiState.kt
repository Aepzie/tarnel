package org.velabrowser.vela.browser

import android.content.Intent

enum class Panel { NONE, TABS, MENU, SPACES, HISTORY, SETTINGS }

data class ContextTarget(val tabId: String, val link: String?, val image: String?, val linkText: String? = null)

enum class PermissionKind(val label: String) { CAMERA("camera"), MICROPHONE("microphone"), LOCATION("location") }

class PermissionPrompt(
    val tabId: String,
    val origin: String,
    val kinds: Set<PermissionKind>,
    val decide: (allow: Boolean) -> Unit,
    val token: Any? = null,
)

class ExternalPrompt(val tabId: String, val intent: Intent, val target: String, val fallbackUrl: String?)

data class UiMessage(
    val text: String,
    val actionLabel: String? = null,
    val action: (() -> Unit)? = null,
    val id: Long = System.nanoTime(),
)
