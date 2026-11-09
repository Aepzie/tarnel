import type { CompiledRule } from './rule';
import type { QueryKeyValue, RequestInfo, URLTransform } from './types';

/**
 * Redirect targets of `redirect` and `upgradeScheme` rules. Returns null when the rule does not
 * apply (not upgradeable, invalid result, or a redirect to the request's own URL).
 */

function splitQuery(query: string): string[] {
  return query === '' ? [] : query.split('&');
}

function keyOf(part: string): string {
  const eq = part.indexOf('=');
  return eq < 0 ? part : part.slice(0, eq);
}

/** Query edits on the raw query string (no re-encoding, so signed / odd URLs survive). */
function transformQuery(search: string, removeParams: readonly string[] | undefined, add: readonly QueryKeyValue[] | undefined): string {
  let parts = splitQuery(search.startsWith('?') ? search.slice(1) : search);
  if (removeParams && removeParams.length > 0) {
    const remove = new Set(removeParams);
    parts = parts.filter((part) => !remove.has(keyOf(part)));
  }
  for (const param of add ?? []) {
    const value = `${param.key}=${param.value}`;
    const index = parts.findIndex((part) => keyOf(part) === param.key);
    if (index >= 0) parts[index] = value;
    else if (!param.replaceOnly) parts.push(value);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function applyTransform(url: string, transform: URLTransform): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (transform.scheme !== undefined) {
    const next = `${transform.scheme}:`;
    if (next !== parsed.protocol) {
      try {
        parsed = new URL(`${next}${parsed.href.slice(parsed.protocol.length)}`);
      } catch {
        return null;
      }
      if (transform.port === undefined && ((next === 'https:' && parsed.port === '80') || (next === 'http:' && parsed.port === '443'))) parsed.port = '';
    }
  }
  if (transform.host !== undefined) parsed.hostname = transform.host;
  if (transform.port !== undefined) parsed.port = transform.port;
  if (transform.path !== undefined) parsed.pathname = transform.path === '' ? '/' : transform.path;
  if (transform.username !== undefined) parsed.username = transform.username;
  if (transform.password !== undefined) parsed.password = transform.password;
  if (transform.query !== undefined) {
    parsed.search = transform.query;
  } else if (transform.queryTransform) {
    const next = transformQuery(parsed.search, transform.queryTransform.removeParams, transform.queryTransform.addOrReplaceParams);
    const hash = parsed.hash;
    const base = parsed.href.slice(0, parsed.href.length - hash.length - parsed.search.length);
    try {
      parsed = new URL(`${base}${next}${hash}`);
    } catch {
      return null;
    }
  }
  if (transform.fragment !== undefined) parsed.hash = transform.fragment;
  return parsed.href;
}

/** RE2 rewrite syntax: `\0`–`\9` insert capture groups, `\\` a backslash. Replaces the first match. */
function substitute(rule: CompiledRule, url: string, substitution: string): string | null {
  const match = rule.pattern?.exec?.(url);
  if (!match) return null;
  let replacement = '';
  for (let i = 0; i < substitution.length; i += 1) {
    const ch = substitution[i]!;
    if (ch !== '\\') {
      replacement += ch;
      continue;
    }
    const next = substitution[i + 1];
    if (next === undefined) return null;
    if (next === '\\') replacement += '\\';
    else if (next >= '0' && next <= '9') replacement += match[Number(next)] ?? '';
    else return null;
    i += 1;
  }
  return url.slice(0, match.index) + replacement + url.slice(match.index + match[0].length);
}

function validTarget(target: string | null, url: string): string | null {
  if (!target || target === url) return null;
  try {
    return new URL(target).href === url ? null : target;
  } catch {
    return null;
  }
}

export function redirectUrl(rule: CompiledRule, request: RequestInfo, extensionId: string): string | null {
  if (rule.type === 'upgradeScheme') {
    if (request.scheme !== 'http' && request.scheme !== 'ftp') return null;
    return validTarget(applyTransform(request.url, { scheme: 'https' }), request.url);
  }
  const redirect = rule.action.redirect;
  if (!redirect) return null;
  if (redirect.url !== undefined) return validTarget(redirect.url, request.url);
  if (redirect.extensionPath !== undefined) return validTarget(`chrome-extension://${extensionId}${redirect.extensionPath}`, request.url);
  if (redirect.regexSubstitution !== undefined) return validTarget(substitute(rule, request.url, redirect.regexSubstitution), request.url);
  if (redirect.transform) return validTarget(applyTransform(request.url, redirect.transform), request.url);
  return null;
}
