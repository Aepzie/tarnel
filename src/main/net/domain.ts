/**
 * Registrable domain (eTLD+1) heuristic, shared by privacy (third-party cookies), fingerprinting
 * (per-site keys) and extension declarativeNetRequest (domainType). Pure: no Electron imports, so
 * node unit tests can load it.
 */

/** Common multi-label public suffixes. Not the full PSL, but covers the vast majority of real traffic. */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp', 'gr.jp', 'lg.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw',
  'com.sg', 'edu.sg', 'gov.sg', 'org.sg', 'net.sg',
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'ac.in', 'edu.in', 'gov.in',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx',
  'com.ar', 'org.ar', 'gob.ar', 'net.ar',
  'co.za', 'org.za', 'gov.za', 'ac.za', 'net.za',
  'com.tr', 'org.tr', 'net.tr', 'gov.tr', 'edu.tr',
  'com.ua', 'org.ua', 'net.ua', 'gov.ua',
  'co.il', 'org.il', 'ac.il', 'gov.il',
  'com.my', 'org.my', 'gov.my', 'edu.my',
  'co.id', 'or.id', 'go.id', 'ac.id', 'web.id',
  'co.th', 'or.th', 'go.th', 'ac.th', 'in.th',
  'com.vn', 'com.ph', 'com.pk', 'com.eg', 'com.sa', 'com.co', 'com.pe', 'com.ve', 'com.ng', 'com.pl',
  'com.es', 'com.pt', 'com.ru', 'com.gr', 'co.at', 'or.at', 'gv.at', 'co.hu',
  // Popular private suffixes (each subdomain is a different owner).
  'github.io', 'gitlab.io', 'githubusercontent.com', 'herokuapp.com', 'netlify.app', 'vercel.app',
  'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'appspot.com', 'blogspot.com',
  'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'fly.dev', 'onrender.com', 'glitch.me',
  'repl.co', 'surge.sh', 'neocities.org', 'wordpress.com', 'tumblr.com', 'substack.com',
]);

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || isIpAddress(h)) return h;
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const lastThree = labels.slice(-3).join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return lastThree;
  if (labels.length >= 4 && MULTI_LABEL_SUFFIXES.has(lastThree)) return labels.slice(-4).join('.');
  return lastTwo;
}
