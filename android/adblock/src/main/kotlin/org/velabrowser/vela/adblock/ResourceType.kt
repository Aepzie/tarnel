package org.velabrowser.vela.adblock

/**
 * Kind of resource being requested, mapped from the WebView request (main frame, iframe,
 * `Accept` header / file extension heuristics, etc.) by the caller.
 */
enum class ResourceType {
    DOCUMENT,
    SUBDOCUMENT,
    SCRIPT,
    STYLESHEET,
    IMAGE,
    MEDIA,
    FONT,
    XHR,
    WEBSOCKET,
    PING,
    OTHER,
}
