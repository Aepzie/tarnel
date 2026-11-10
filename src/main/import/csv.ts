import type { ImportedLogin } from '../../shared/passwords';

/** RFC 4180 CSV: quoted fields, "" escapes, commas and line breaks inside quotes, CRLF/LF, leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = (): void => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

const URL_COLUMNS = ['url', 'login_uri', 'website', 'web site', 'login url', 'uri', 'origin', 'hostname'];
const USER_COLUMNS = ['username', 'login_username', 'user name', 'login name', 'login', 'email', 'user'];
const PASSWORD_COLUMNS = ['password', 'login_password'];

export interface ParsedPasswordCsv {
  format: string;
  logins: ImportedLogin[];
  skipped: number;
}

function detectFormat(header: readonly string[]): string {
  const has = (name: string): boolean => header.includes(name);
  if (has('login_uri') || has('login_password')) return 'Bitwarden';
  if (has('httprealm') || has('formactionorigin')) return 'Firefox';
  if (has('name') && has('url') && has('note')) return 'Chrome / Edge / Brave';
  if (has('title') && (has('otpauth') || has('website') || has('archived'))) return '1Password';
  return 'CSV';
}

/** "example.com" → "https://example.com"; only http(s) logins are kept. */
export function normaliseLoginUrl(raw: string): string | null {
  const first = raw.split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  if (!first) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(first) ? first : `https://${first}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Maps an exported password CSV (Chrome/Edge/Brave, Firefox, Bitwarden, 1Password, generic) to logins. */
export function parsePasswordCsv(text: string): ParsedPasswordCsv {
  const rows = parseCsv(text);
  const header = rows[0]?.map((name) => name.trim().toLowerCase()) ?? [];
  const column = (names: readonly string[]): number => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  };
  const urlCol = column(URL_COLUMNS);
  const userCol = column(USER_COLUMNS);
  const passCol = column(PASSWORD_COLUMNS);
  if (urlCol === -1 || passCol === -1) throw new Error('This file has no url and password columns.');
  const typeCol = header.indexOf('type');
  const format = detectFormat(header);

  const logins: ImportedLogin[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    if (format === 'Bitwarden' && typeCol !== -1 && row[typeCol] && row[typeCol] !== 'login') {
      skipped++;
      continue;
    }
    const url = normaliseLoginUrl(row[urlCol] ?? '');
    const password = row[passCol] ?? '';
    if (!url || !password) {
      skipped++;
      continue;
    }
    logins.push({ url, username: userCol === -1 ? '' : (row[userCol] ?? '').trim(), password });
  }
  return { format, logins, skipped };
}
