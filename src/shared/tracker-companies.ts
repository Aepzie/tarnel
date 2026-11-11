/**
 * Small embedded map from tracker registrable domains to the company that operates them, for the
 * privacy report's "top companies". Hand-written from public ownership facts (no third-party
 * database is bundled; Ghostery's TrackerDB is not a dependency). Unknown domains stay unattributed.
 */
const COMPANY_DOMAINS: Record<string, readonly string[]> = {
  Google: [
    'google-analytics.com', 'googletagmanager.com', 'googletagservices.com', 'doubleclick.net', 'googlesyndication.com',
    'googleadservices.com', 'google.com', 'gstatic.com', 'googleapis.com', '2mdn.net', 'app-measurement.com',
    'youtube.com', 'ytimg.com', 'googlevideo.com', 'admob.com',
  ],
  Meta: ['facebook.net', 'facebook.com', 'fbcdn.net', 'instagram.com', 'atdmt.com'],
  Microsoft: ['bing.com', 'clarity.ms', 'msn.com', 'microsoft.com', 'linkedin.com', 'licdn.com', 'adnxs.com', 'xandr.com'],
  Amazon: ['amazon-adsystem.com', 'amazon.com', 'media-amazon.com', 'assoc-amazon.com'],
  'X (Twitter)': ['twitter.com', 'x.com', 'ads-twitter.com', 'twimg.com', 't.co'],
  TikTok: ['tiktok.com', 'tiktokcdn.com', 'byteoversea.com', 'ibytedtos.com'],
  Adobe: ['demdex.net', 'omtrdc.net', '2o7.net', 'everesttech.net', 'adobedtm.com', 'typekit.net'],
  Oracle: ['bluekai.com', 'addthis.com', 'moatads.com', 'eloqua.com'],
  Criteo: ['criteo.com', 'criteo.net'],
  'The Trade Desk': ['adsrvr.org'],
  Taboola: ['taboola.com', 'taboolasyndication.com'],
  Outbrain: ['outbrain.com', 'outbrainimg.com'],
  Yahoo: ['yahoo.com', 'yimg.com', 'advertising.com', 'adtechus.com'],
  Magnite: ['rubiconproject.com', 'magnite.com'],
  PubMatic: ['pubmatic.com'],
  OpenX: ['openx.net'],
  'Index Exchange': ['casalemedia.com', 'indexww.com'],
  Quantcast: ['quantserve.com', 'quantcount.com', 'quantcast.com'],
  Comscore: ['scorecardresearch.com', 'comscore.com'],
  Nielsen: ['imrworldwide.com', 'exelator.com'],
  LiveRamp: ['rlcdn.com', 'pippio.com'],
  Lotame: ['crwdcntrl.net'],
  Hotjar: ['hotjar.com', 'hotjar.io'],
  'New Relic': ['nr-data.net', 'newrelic.com'],
  Segment: ['segment.com', 'segment.io'],
  Mixpanel: ['mixpanel.com'],
  Amplitude: ['amplitude.com'],
  Chartbeat: ['chartbeat.com', 'chartbeat.net'],
  Parsely: ['parsely.com', 'parse.ly'],
  Optimizely: ['optimizely.com'],
  Sovrn: ['lijit.com', 'sovrn.com'],
  Smart: ['smartadserver.com'],
  Teads: ['teads.tv'],
  'Media.net': ['media.net'],
  Yandex: ['yandex.ru', 'yandex.net'],
  Snap: ['snapchat.com', 'sc-static.net'],
  Pinterest: ['pinterest.com', 'pinimg.com'],
  Reddit: ['redditstatic.com', 'redditmedia.com', 'reddit.com'],
  HubSpot: ['hubspot.com', 'hs-analytics.net', 'hs-scripts.com', 'hsforms.net'],
  Cloudflare: ['cloudflareinsights.com'],
  Sentry: ['sentry.io', 'sentry-cdn.com'],
  Permutive: ['permutive.com', 'permutive.app'],
  ID5: ['id5-sync.com'],
  Tapad: ['tapad.com'],
  Zeta: ['rezync.com'],
  Seedtag: ['seedtag.com'],
  Yieldmo: ['yieldmo.com'],
  GumGum: ['gumgum.com'],
  TripleLift: ['3lift.com'],
  Sharethrough: ['sharethrough.com'],
  Kargo: ['kargo.com'],
  'Integral Ad Science': ['adsafeprotected.com'],
  DoubleVerify: ['doubleverify.com'],
  Piano: ['piano.io', 'tinypass.com', 'cxense.com'],
  OneTrust: ['onetrust.com', 'cookielaw.org'],
  Didomi: ['privacy-center.org'],
};

const OWNER = new Map<string, string>(
  Object.entries(COMPANY_DOMAINS).flatMap(([company, domains]) => domains.map((domain) => [domain, company] as const)),
);

/** Company operating a tracker registrable domain, or null when unknown. */
export function trackerCompany(domain: string): string | null {
  return OWNER.get(domain.toLowerCase()) ?? null;
}
