/** Validate the RFC 8941 dictionary before merging: one malformed member makes Chromium
 * ignore the entire header, including a denial appended by us. Keep original member text
 * so valid origins, quoted commas, and reporting parameters retain their meaning. */
const MAX_POLICY_LENGTH = 1 << 16; // Blink PermissionsPolicyParser's MAX_LENGTH_PARSE.

function policyMembers(value: string): Map<string, string> | null {
  if (value.length > MAX_POLICY_LENGTH) return null;
  const members = new Map<string, string>();
  let at = 0;
  const take = (pattern: RegExp): string | null => {
    const found = pattern.exec(value.slice(at));
    if (!found) return null;
    at += found[0].length;
    return found[0];
  };
  const spaces = (): void => { take(/^ */); };
  const key = (): string | null => take(/^[a-z*][a-z0-9_.*-]*/);
  const bare = (): boolean => {
    if (value[at] === '"') {
      at++;
      while (at < value.length) {
        const char = value[at++];
        if (char === '"') return true;
        if (char === '\\') {
          if (value[at] !== '"' && value[at] !== '\\') return false;
          at++;
        } else if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) > 0x7e) return false;
      }
      return false;
    }
    if (value[at] === '?') return take(/^\?[01]/) !== null;
    if (value[at] === ':') {
      const bytes = take(/^:([A-Za-z0-9+/]*={0,2}):/);
      if (!bytes) return false;
      const body = bytes.slice(1, -1);
      return body.length % 4 !== 1 && (!body.includes('=') || body.length % 4 === 0);
    }
    if (/[-0-9]/.test(value[at] ?? '')) {
      const number = take(/^-?\d+(?:\.\d+)?/);
      if (!number) return false;
      const [integer, fraction] = number.replace(/^-/, '').split('.');
      return fraction === undefined ? integer.length <= 15 : integer.length <= 12 && fraction.length <= 3;
    }
    return take(/^[A-Za-z*][A-Za-z0-9!#$%&'*+.^_`|~:/-]*/) !== null;
  };
  const parameters = (): boolean => {
    while (value[at] === ';') {
      at++;
      spaces();
      if (!key()) return false;
      if (value[at] === '=') { at++; if (!bare()) return false; }
    }
    return true;
  };
  const item = (): boolean => bare() && parameters();
  const memberValue = (): boolean => {
    if (value[at] !== '(') return item();
    at++;
    spaces();
    while (value[at] !== ')') {
      if (!item()) return false;
      if (value[at] !== ')' && value[at] !== ' ') return false;
      spaces();
    }
    at++;
    return parameters();
  };
  spaces();
  while (at < value.length) {
    const start = at;
    const name = key();
    if (!name) return null;
    if (value[at] === '=') {
      at++;
      if (!memberValue()) return null;
    } else if (!parameters()) return null;
    members.set(name, value.slice(start, at));
    take(/^[ \t]*/);
    if (at === value.length) return members;
    if (value[at++] !== ',') return null;
    take(/^[ \t]*/);
    if (at === value.length) return null;
  }
  return members;
}

/** Keep unrelated valid policies; replace all copies of encrypted-media with a native deny. */
export function denyEncryptedMedia(headers: Record<string, string[]> | undefined): Record<string, string[]> {
  const next = { ...headers };
  const values: string[] = [];
  for (const name of Object.keys(next)) {
    if (name.toLowerCase() !== 'permissions-policy') continue;
    values.push(...next[name]);
    delete next[name];
  }
  // Chromium combines repeated fields before parsing. Invalid originals already impose
  // no restrictions, so replacing that whole invalid dictionary loses no valid policy.
  const members = policyMembers(values.join(', '));
  members?.delete('encrypted-media');
  const policies = members ? [...members.values()] : [];
  const policy = [...policies, 'encrypted-media=()'].join(', ');
  // A valid original close to Blink's limit cannot safely be extended. The caller
  // must cancel this response; discarding its valid restrictions would weaken it.
  if (policy.length > MAX_POLICY_LENGTH) throw new RangeError('DRM permissions policy exceeds Chromium limit');
  next['Permissions-Policy'] = [policy];
  return next;
}
