/** CSV export in the Chrome / Bitwarden / 1Password import format. Pure (unit-tested). */

export interface CsvLogin {
  origin: string;
  username: string;
  password: string;
}

/** RFC 4180: quote when the field has a comma, quote, CR/LF or edge whitespace; double inner quotes. */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value) || value !== value.trim()) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function loginsToCsv(logins: readonly CsvLogin[]): string {
  const rows = [['name', 'url', 'username', 'password', 'note']];
  for (const login of logins) {
    rows.push([login.origin.replace(/^https?:\/\//, ''), login.origin, login.username, login.password, '']);
  }
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
