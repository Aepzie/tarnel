package org.velabrowser.vela.adblock

import org.velabrowser.vela.core.UrlInput
import java.util.Locale

/**
 * Minimal built-in blocker so the app works standalone: a host suffix list of well-known ad and tracking
 * domains, applied to third-party sub-resources only, plus a few generic element-hiding rules.
 * Replaced by the real filter-list engine (`:adblock` module) when it is wired in.
 */
class HostListBlocker(hosts: Collection<String> = DEFAULT_HOSTS) : ContentBlocker {
    private val blocked: Set<String> = hosts.map { it.lowercase(Locale.ROOT) }.toHashSet()

    override fun shouldBlock(url: String, documentUrl: String?, kind: RequestKind): Boolean {
        if (kind == RequestKind.DOCUMENT) return false
        val host = UrlInput.hostOf(url) ?: return false
        if (!matches(host)) return false
        val docHost = documentUrl?.let(UrlInput::hostOf) ?: return true
        // Never break a site that is itself on the list (e.g. visiting an ad network's homepage).
        return UrlInput.siteOf(docHost) != UrlInput.siteOf(host)
    }

    override fun cosmeticCss(documentUrl: String): String = GENERIC_CSS

    private fun matches(host: String): Boolean {
        var candidate = host
        while (true) {
            if (candidate in blocked) return true
            val dot = candidate.indexOf('.')
            if (dot < 0 || dot == candidate.lastIndexOf('.')) return false
            candidate = candidate.substring(dot + 1)
        }
    }

    companion object {
        val DEFAULT_HOSTS = listOf(
            "doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com",
            "googletagmanager.com", "googletagservices.com", "adservice.google.com", "pagead2.googlesyndication.com",
            "2mdn.net", "adnxs.com", "adsrvr.org", "advertising.com", "amazon-adsystem.com", "taboola.com",
            "outbrain.com", "criteo.com", "criteo.net", "pubmatic.com", "rubiconproject.com", "openx.net",
            "casalemedia.com", "moatads.com", "scorecardresearch.com", "quantserve.com", "hotjar.com",
            "mixpanel.com", "segment.io", "segment.com", "fullstory.com", "crazyegg.com", "mouseflow.com",
            "adform.net", "smartadserver.com", "yieldmo.com", "sharethrough.com", "teads.tv", "media.net",
            "bidswitch.net", "contextweb.com", "33across.com", "indexww.com", "lijit.com", "sovrn.com",
            "zedo.com", "adroll.com", "bluekai.com", "krxd.net", "demdex.net", "everesttech.net",
            "exelator.com", "mathtag.com", "serving-sys.com", "tapad.com", "turn.com", "yieldlab.net",
            "connect.facebook.net", "ads-twitter.com", "analytics.twitter.com", "ads.linkedin.com",
            "analytics.tiktok.com", "ads.yahoo.com", "adtech.de", "omtrdc.net", "chartbeat.com", "newrelic.com",
            "nr-data.net", "clarity.ms", "bat.bing.com", "popads.net", "propellerads.com", "adsterra.com",
        )

        private const val GENERIC_CSS =
            "ins.adsbygoogle,.adsbygoogle,[id^=\"google_ads_iframe\"],[id^=\"div-gpt-ad\"],[data-ad-slot]," +
                "iframe[src*=\"doubleclick.net\"],iframe[src*=\"googlesyndication.com\"],.OUTBRAIN,.trc_rbox_container" +
                "{display:none!important}"
    }
}
