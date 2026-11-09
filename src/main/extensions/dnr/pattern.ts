/**
 * URL patterns of declarativeNetRequest rules: `urlFilter` (Chrome's simple filter syntax) and
 * `regexFilter` (RE2, translated to a JS RegExp). Besides compiling a matcher, both yield *index
 * keys*: a pattern is only ever tested against requests that share one of its keys (see ruleset.ts).
 *
 * Token rule (same idea as the Android engine in android/adblock): a token is a maximal run of
 * `[a-z0-9%]`. A token taken from a pattern is only usable as a key when the pattern pins both of
 * its ends to a non-token character (a literal separator, `^`, an anchor), because only then is it
 * guaranteed to appear as a whole token of every URL the pattern matches.
 */

/** URL token characters. Kept in sync with tokenizeUrl() below. */
export function isTokenChar(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 37;
}

/** Chrome's `^`: anything but a letter, a digit, `_`, `-`, `.` or `%` (or the end of the URL). */
const SEPARATOR = '(?:[^A-Za-z0-9_\\-.%]|$)';
/** `||`: the pattern starts at the beginning of the host or of one of its subdomains. */
const DOMAIN_ANCHOR = '^[a-z][a-z0-9+.\\-]*:\\/\\/(?:[^\\/?#]*[.@])?';
const HOST_CHAR = /[A-Za-z0-9_\-.]/;

export interface CompiledPattern {
  /** Test against the request; `url` is the original, `lower` the lower-cased URL. */
  test(url: string, lower: string): boolean;
  /** For regexFilter + regexSubstitution: the match (lazily compiled RegExp). */
  exec?(url: string): RegExpExecArray | null;
  /** Candidate index tokens (lower case, length >= 2), any one of which every match contains. */
  tokens: string[];
  /** Exact host the pattern is anchored to (`||host^`, `||host/…`), if any. */
  host: string | null;
  /** The pattern is exactly `||host^` / `||host` + separator: a host match is a full match. */
  hostOnly: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

type Atom = { kind: 'lit'; ch: string } | { kind: 'sep' } | { kind: 'any' };

/** Tokens pinned on both sides by separators (see the module comment). */
function boundedTokens(atoms: Atom[]): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < atoms.length) {
    const atom = atoms[i]!;
    if (atom.kind !== 'lit' || !isTokenChar(atom.ch.toLowerCase().charCodeAt(0))) {
      i += 1;
      continue;
    }
    const start = i;
    let token = '';
    while (i < atoms.length) {
      const next = atoms[i]!;
      if (next.kind !== 'lit') break;
      const lower = next.ch.toLowerCase();
      if (!isTokenChar(lower.charCodeAt(0))) break;
      token += lower;
      i += 1;
    }
    const before = start === 0 ? undefined : atoms[start - 1];
    const after = atoms[i];
    const leftPinned = before !== undefined && before.kind !== 'any';
    const rightPinned = after !== undefined && after.kind !== 'any';
    if (leftPinned && rightPinned && token.length >= 2) tokens.push(token);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// urlFilter

export function isValidUrlFilter(filter: string): string | null {
  if (filter.length === 0) return 'urlFilter must be non-empty';
  for (let i = 0; i < filter.length; i += 1) {
    if (filter.charCodeAt(i) > 127) return 'urlFilter must be ASCII';
  }
  if (filter.startsWith('|||')) return 'urlFilter has an invalid domain anchor';
  const inner = filter.slice(filter.startsWith('||') ? 2 : filter.startsWith('|') ? 1 : 0, filter.endsWith('|') ? -1 : undefined);
  if (inner.includes('|')) return "urlFilter may only use '|' as an anchor";
  return null;
}

const STAR = 42;
const CARET = 94;

/**
 * Bounded tokens of a urlFilter body, scanned in place (no allocation per character: uBlock Origin
 * Lite alone ships ~20k urlFilters that are compiled at startup).
 */
function lowerCode(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function urlFilterTokens(body: string, leftPinned: boolean, rightPinned: boolean): string[] {
  const tokens: string[] = [];
  const length = body.length;
  let i = 0;
  while (i < length) {
    if (!isTokenChar(lowerCode(body.charCodeAt(i)))) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < length && isTokenChar(lowerCode(body.charCodeAt(i)))) i += 1;
    const before = start === 0 ? (leftPinned ? CARET : STAR) : body.charCodeAt(start - 1);
    const after = i === length ? (rightPinned ? CARET : STAR) : body.charCodeAt(i);
    if (before !== STAR && after !== STAR && i - start >= 2) tokens.push(body.slice(start, i).toLowerCase());
  }
  return tokens;
}

const enum Anchor {
  None,
  Start,
  Domain,
}

class UrlFilterPattern implements CompiledPattern {
  private regex: RegExp | null = null;

  constructor(
    private readonly body: string,
    private readonly anchor: Anchor,
    private readonly endAnchor: boolean,
    private readonly caseSensitive: boolean,
    /** Substring to look for when the filter has no anchors / wildcards / separators. */
    private readonly plain: string | null,
    public tokens: string[],
    readonly host: string | null,
    readonly hostOnly: boolean,
  ) {}

  test(url: string, lower: string): boolean {
    if (this.plain !== null) return this.caseSensitive ? url.includes(this.plain) : lower.includes(this.plain);
    if (this.literal === undefined) this.literal = this.longestLiteral();
    if (this.literal && !(this.caseSensitive ? url : lower).includes(this.literal)) return false;
    this.regex ??= this.compile();
    return this.regex.test(url);
  }

  /** Cheap pre-check before the regex: the longest literal run must occur in the URL. */
  private literal: string | undefined = undefined;

  private longestLiteral(): string {
    let best = '';
    for (const part of this.body.split(/[*^]/)) if (part.length > best.length) best = part;
    return this.caseSensitive ? best : best.toLowerCase();
  }

  private compile(): RegExp {
    let source = this.anchor === Anchor.Domain ? DOMAIN_ANCHOR : this.anchor === Anchor.Start ? '^' : '';
    for (const part of this.body.split(/([*^])/)) {
      if (part === '*') source += '.*';
      else if (part === '^') source += SEPARATOR;
      else if (part) source += escapeRegExp(part);
    }
    if (this.endAnchor) source += '$';
    return new RegExp(source, this.caseSensitive ? '' : 'i');
  }
}

export function compileUrlFilter(filter: string, caseSensitive: boolean): CompiledPattern {
  let body = filter;
  let anchor = Anchor.None;
  let endAnchor = false;
  if (body.startsWith('||')) {
    anchor = Anchor.Domain;
    body = body.slice(2);
  } else if (body.startsWith('|')) {
    anchor = Anchor.Start;
    body = body.slice(1);
  }
  if (body.endsWith('|')) {
    endAnchor = true;
    body = body.slice(0, -1);
  }
  if (anchor !== Anchor.Start && body.startsWith('*')) {
    // `*x` and `||*x` both mean "x anywhere after the scheme": drop the wildcard so the filter can
    // become a plain substring test instead of a backtracking `.*x` regex.
    body = body.replace(/^\*+/, '');
    anchor = Anchor.None;
  }
  if (!endAnchor && body.endsWith('*')) body = body.replace(/\*+$/, '');
  if (body === '') body = '*';
  const tokens = urlFilterTokens(body, anchor !== Anchor.None, endAnchor);

  let host: string | null = null;
  let hostOnly = false;
  if (anchor === Anchor.Domain) {
    let end = 0;
    while (end < body.length && HOST_CHAR.test(body[end]!)) end += 1;
    const terminator = body[end];
    let candidate = body.slice(0, end).toLowerCase();
    if (candidate.endsWith('.')) candidate = candidate.slice(0, -1);
    if (candidate && (terminator === '^' || terminator === '/' || terminator === ':' || terminator === '?')) {
      host = candidate;
      hostOnly = terminator === '^' && end === body.length - 1 && !endAnchor;
    }
  }

  const plain = anchor === Anchor.None && !endAnchor && body.indexOf('*') < 0 && body.indexOf('^') < 0;
  const needle = plain ? (caseSensitive ? body : body.toLowerCase()) : null;
  return new UrlFilterPattern(body, anchor, endAnchor, caseSensitive, needle, tokens, host, hostOnly);
}

// ---------------------------------------------------------------------------
// regexFilter (RE2 → JS)

export type RegexProblem = 'syntaxError' | 'memoryLimitExceeded';

export interface TranslatedRegex {
  source: string;
  /** Extra flags requested inline with a leading `(?i)` / `(?s)`. */
  flags: string;
}

const POSIX_CLASSES: Record<string, string> = {
  alnum: 'A-Za-z0-9',
  alpha: 'A-Za-z',
  ascii: '\\x00-\\x7F',
  blank: ' \\t',
  cntrl: '\\x00-\\x1F\\x7F',
  digit: '0-9',
  graph: '!-~',
  lower: 'a-z',
  print: ' -~',
  punct: '!-\\/:-@\\[-`{-~',
  space: '\\t\\n\\v\\f\\r ',
  upper: 'A-Z',
  word: 'A-Za-z0-9_',
  xdigit: '0-9A-Fa-f',
};

/** RE2 rejects counted repetitions above 1000; Chrome also caps the compiled program size. */
const MAX_REPEAT = 1000;
const MAX_REGEX_LENGTH = 2048;

/**
 * Translate an RE2 pattern into an equivalent JS RegExp source, or report why it can't be used.
 * Features RE2 doesn't have (look-around, backreferences) are rejected like Chrome would.
 */
export function translateRegex(pattern: string): TranslatedRegex | { problem: RegexProblem } {
  if (pattern.length === 0) return { problem: 'syntaxError' };
  if (pattern.length > MAX_REGEX_LENGTH) return { problem: 'memoryLimitExceeded' };
  let flags = '';
  let rest = pattern;
  const leading = /^\(\?([imsU]+)\)/.exec(rest);
  if (leading) {
    for (const flag of leading[1]!) {
      if (flag === 'i' && !flags.includes('i')) flags += 'i';
      else if (flag === 's' && !flags.includes('s')) flags += 's';
      else if (flag === 'm' && !flags.includes('m')) flags += 'm';
      else if (flag === 'U') return { problem: 'syntaxError' };
    }
    rest = rest.slice(leading[0].length);
  }
  let out = '';
  let inClass = false;
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i]!;
    if (ch === '\\') {
      const next = rest[i + 1];
      if (next === undefined) return { problem: 'syntaxError' };
      if (/[1-9]/.test(next) && !inClass) return { problem: 'syntaxError' };
      if (next === 'Q') {
        const end = rest.indexOf('\\E', i + 2);
        const literal = rest.slice(i + 2, end < 0 ? undefined : end);
        out += escapeRegExp(literal);
        i = end < 0 ? rest.length : end + 1;
        continue;
      }
      if (next === 'A') {
        out += '^';
        i += 1;
        continue;
      }
      if (next === 'z') {
        out += '$';
        i += 1;
        continue;
      }
      if (next === 'C' || next === 'p' || next === 'P') return { problem: 'syntaxError' };
      out += ch + next;
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === '[' && rest[i + 1] === ':') {
        const close = rest.indexOf(':]', i + 2);
        if (close < 0) return { problem: 'syntaxError' };
        let name = rest.slice(i + 2, close);
        const negated = name.startsWith('^');
        if (negated) name = name.slice(1);
        const set = POSIX_CLASSES[name];
        if (!set || negated) return { problem: 'syntaxError' };
        out += set;
        i = close + 1;
        continue;
      }
      if (ch === ']') inClass = false;
      out += ch;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      out += ch;
      if (rest[i + 1] === '^') {
        out += '^';
        i += 1;
      }
      if (rest[i + 1] === ']') {
        out += '\\]';
        i += 1;
      }
      continue;
    }
    if (ch === '(' && rest[i + 1] === '?') {
      const kind = rest.slice(i + 2, i + 4);
      if (kind.startsWith('=') || kind.startsWith('!') || kind === '<=' || kind === '<!') return { problem: 'syntaxError' };
      if (rest[i + 2] === 'P' && rest[i + 3] === '<') {
        out += '(?<';
        i += 3;
        continue;
      }
    }
    if (ch === '{') {
      const repeat = /^\{(\d+)(?:,(\d*))?\}/.exec(rest.slice(i));
      if (repeat) {
        const low = Number(repeat[1]);
        const high = repeat[2] ? Number(repeat[2]) : low;
        if (low > MAX_REPEAT || high > MAX_REPEAT) return { problem: 'memoryLimitExceeded' };
      }
    }
    out += ch;
  }
  if (inClass) return { problem: 'syntaxError' };
  try {
    new RegExp(out, flags);
  } catch {
    return { problem: 'syntaxError' };
  }
  return { source: out, flags };
}

/** Bounded literal tokens of a regex (see the module comment). Any alternation disables tokens. */
export function regexTokens(source: string): string[] {
  const atoms: Atom[] = [];
  let depth = 0;
  let inClass = false;
  const quantifier = (index: number): boolean => {
    const ch = source[index];
    return ch === '*' || ch === '+' || ch === '?' || (ch === '{' && /^\{\d+(,\d*)?\}/.test(source.slice(index)));
  };
  const markQuantified = (index: number): void => {
    if (!quantifier(index)) return;
    atoms[atoms.length - 1] = { kind: 'any' };
    atoms.push({ kind: 'any' });
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inClass) {
      if (ch === '\\') i += 1;
      else if (ch === ']') {
        inClass = false;
        if (depth === 0) {
          atoms.push({ kind: 'any' });
          markQuantified(i + 1);
        }
      }
      continue;
    }
    if (ch === '\\') {
      const next = source[i + 1] ?? '';
      i += 1;
      if (depth > 0) continue;
      if (/[A-Za-z0-9]/.test(next)) atoms.push({ kind: 'any' });
      else atoms.push({ kind: 'lit', ch: next });
      markQuantified(i + 1);
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '|') return [];
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        atoms.push({ kind: 'any' });
        markQuantified(i + 1);
      }
      continue;
    }
    if (depth > 0) continue;
    if (ch === '^' || ch === '$') {
      atoms.push({ kind: 'sep' });
      continue;
    }
    if (ch === '.') {
      atoms.push({ kind: 'any' });
      markQuantified(i + 1);
      continue;
    }
    if (quantifier(i)) {
      if (ch === '{') i = source.indexOf('}', i);
      continue;
    }
    atoms.push({ kind: 'lit', ch });
    markQuantified(i + 1);
  }
  return boundedTokens(atoms);
}

export function compileRegexFilter(translated: TranslatedRegex, caseSensitive: boolean): CompiledPattern {
  let flags = translated.flags;
  if (!caseSensitive && !flags.includes('i')) flags += 'i';
  let regex: RegExp | null = null;
  const get = (): RegExp => (regex ??= new RegExp(translated.source, flags));
  return {
    test: (url) => get().test(url),
    exec: (url) => get().exec(url),
    tokens: regexTokens(translated.source),
    host: null,
    hostOnly: false,
  };
}

/** Request URL tokens (lower case, length >= 2). */
export function tokenizeUrl(lower: string): string[] {
  const tokens: string[] = [];
  const length = lower.length;
  let i = 0;
  while (i < length) {
    if (!isTokenChar(lower.charCodeAt(i))) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < length && isTokenChar(lower.charCodeAt(i))) i += 1;
    if (i - start >= 2) tokens.push(lower.slice(start, i));
  }
  return tokens;
}
