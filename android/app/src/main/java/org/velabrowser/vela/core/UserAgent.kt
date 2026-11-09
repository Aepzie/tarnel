package org.velabrowser.vela.core

object UserAgent {
    /**
     * Chrome's reduced user agent without the WebView markers ("; wv", "Version/4.0", device model), so sites
     * treat Vela like a regular mobile browser and the UA carries no device fingerprint.
     */
    fun clean(raw: String): String {
        val major = Regex("Chrome/(\\d+)").find(raw)?.groupValues?.get(1) ?: return raw.replace("; wv", "")
        val mobile = if (raw.contains("Mobile")) " Mobile" else ""
        return "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$major.0.0.0$mobile Safari/537.36"
    }
}
