/**
 * Country flags as small inline SVGs (4:3, viewBox 640×480), drawn for Tarnel so they ship without a
 * dependency or font support (Windows has no flag emoji). Proportions are simplified where a flag has
 * fine detail (stars, emblems); colours follow the official values. Unknown codes return null.
 */

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
const rows = (...colors: string[]): string =>
  svg(colors.map((color, index) => `<rect y="${(480 / colors.length) * index}" width="640" height="${480 / colors.length + 1}" fill="${color}"/>`).join(''));
const columns = (...colors: string[]): string =>
  svg(colors.map((color, index) => `<rect x="${(640 / colors.length) * index}" width="${640 / colors.length + 1}" height="480" fill="${color}"/>`).join(''));
const nordic = (field: string, cross: string, inner?: string): string =>
  svg(
    `<rect width="640" height="480" fill="${field}"/><rect x="176" width="${inner ? 128 : 96}" height="480" fill="${cross}"/><rect y="${inner ? 176 : 192}" width="640" height="${inner ? 128 : 96}" fill="${cross}"/>` +
      (inner ? `<rect x="208" width="64" height="480" fill="${inner}"/><rect y="208" width="640" height="64" fill="${inner}"/>` : ''),
  );
const union = (width: number, height: number): string =>
  `<svg x="0" y="0" width="${width}" height="${height}" viewBox="0 0 60 30" preserveAspectRatio="none"><rect width="60" height="30" fill="#012169"/>` +
  `<path d="M0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6"/><path d="M0 0 60 30M60 0 0 30" stroke="#C8102E" stroke-width="2"/>` +
  `<path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>`;
const star = (cx: number, cy: number, r: number): string => {
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = (Math.PI / 5) * index - Math.PI / 2;
    const radius = index % 2 === 0 ? r : r * 0.42;
    return `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`;
  });
  return `<polygon points="${points.join(' ')}" fill="#fff"/>`;
};

const usStars = (): string => {
  const marks: string[] = [];
  for (let row = 0; row < 9; row++) {
    const count = row % 2 === 0 ? 6 : 5;
    for (let column = 0; column < count; column++) marks.push(star(21 + column * 42 + (row % 2) * 21, 18 + row * 28, 10));
  }
  return marks.join('');
};

const FLAGS: Record<string, string> = {
  at: rows('#C8102E', '#fff', '#C8102E'),
  au: svg(
    `<rect width="640" height="480" fill="#012169"/>${union(320, 240)}${star(160, 360, 46)}${star(480, 400, 26)}${star(400, 230, 22)}${star(480, 100, 26)}${star(555, 205, 22)}${star(515, 275, 12)}`,
  ),
  be: columns('#000', '#FDDA24', '#EF3340'),
  ca: svg(
    `<rect width="640" height="480" fill="#fff"/><rect width="160" height="480" fill="#D80621"/><rect x="480" width="160" height="480" fill="#D80621"/>` +
      `<path fill="#D80621" d="M320 92l-26 50-30-14 12 82-38-36-8 22-44-8 16 44-18 8 66 54-12 30 66-10-2 70h20l-2-70 66 10-12-30 66-54-18-8 16-44-44 8-8-22-38 36 12-82-30 14z"/>`,
  ),
  ch: svg(`<rect width="640" height="480" fill="#DA291C"/><rect x="276" y="120" width="88" height="240" fill="#fff"/><rect x="200" y="196" width="240" height="88" fill="#fff"/>`),
  de: rows('#000', '#DD0000', '#FFCE00'),
  dk: svg(`<rect width="640" height="480" fill="#C8102E"/><rect x="200" width="64" height="480" fill="#fff"/><rect y="208" width="640" height="64" fill="#fff"/>`),
  es: svg(`<rect width="640" height="480" fill="#AA151B"/><rect y="120" width="640" height="240" fill="#F1BF00"/>`),
  fi: nordic('#fff', '#002F6C'),
  fr: columns('#002654', '#fff', '#CE1126'),
  gb: svg(union(640, 480)),
  is: nordic('#02529C', '#fff', '#DC1E35'),
  it: columns('#009246', '#fff', '#CE2B37'),
  jp: svg(`<rect width="640" height="480" fill="#fff"/><circle cx="320" cy="240" r="144" fill="#BC002D"/>`),
  nl: rows('#AE1C28', '#fff', '#21468B'),
  no: nordic('#BA0C2F', '#fff', '#00205B'),
  pl: rows('#fff', '#DC143C'),
  se: nordic('#006AA7', '#FECC02'),
  sg: svg(
    `<rect width="640" height="480" fill="#fff"/><rect width="640" height="240" fill="#EF3340"/><circle cx="150" cy="120" r="78" fill="#fff"/><circle cx="182" cy="120" r="74" fill="#EF3340"/>` +
      `${star(250, 70, 16)}${star(205, 104, 16)}${star(295, 104, 16)}${star(222, 160, 16)}${star(278, 160, 16)}`,
  ),
  us: svg(
    Array.from({ length: 13 }, (_, index) => `<rect y="${(480 / 13) * index}" width="640" height="${480 / 13 + 1}" fill="${index % 2 === 0 ? '#B22234' : '#fff'}"/>`).join('') +
      `<rect width="256" height="258" fill="#3C3B6E"/>${usStars()}`,
  ),
};

const urls = new Map<string, string>();

/** A data: URL of the country's flag (lower- or upper-case ISO code), or null when Tarnel has none. */
export function flagUrl(countryCode: string): string | null {
  const code = countryCode.toLowerCase();
  const markup = FLAGS[code];
  if (!markup) return null;
  let url = urls.get(code);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    urls.set(code, url);
  }
  return url;
}
