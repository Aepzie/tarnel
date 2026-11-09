package org.velabrowser.vela.adblock

/** [ContentBlocker] backed by the filter-list engine of the `:adblock` module (EasyList, EasyPrivacy, …). */
class EngineContentBlocker(val engine: AdblockEngine) : ContentBlocker {
    override fun shouldBlock(url: String, documentUrl: String?, kind: RequestKind): Boolean =
        engine.shouldBlock(url, documentUrl, kind.toResourceType())

    override fun cosmeticCss(documentUrl: String): String? = engine.cosmeticCss(documentUrl)
}

fun RequestKind.toResourceType(): ResourceType = when (this) {
    RequestKind.DOCUMENT -> ResourceType.DOCUMENT
    RequestKind.SUBDOCUMENT -> ResourceType.SUBDOCUMENT
    RequestKind.SCRIPT -> ResourceType.SCRIPT
    RequestKind.STYLESHEET -> ResourceType.STYLESHEET
    RequestKind.IMAGE -> ResourceType.IMAGE
    RequestKind.FONT -> ResourceType.FONT
    RequestKind.MEDIA -> ResourceType.MEDIA
    RequestKind.XHR -> ResourceType.XHR
    RequestKind.OTHER -> ResourceType.OTHER
}
