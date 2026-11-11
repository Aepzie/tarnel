export interface TextSegment {
  lead: string;
  core: string;
  trail: string;
}

/**
 * Splits a text node's value into leading whitespace, translatable core and trailing whitespace;
 * null when there is nothing to translate (no letters). Self-contained on purpose: it is also
 * serialized into the page script (see page-script.ts), so it must not reference anything outside.
 */
export function segmentText(value: string): TextSegment | null {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  if (!match || !match[2] || !/\p{L}/u.test(match[2])) return null;
  return { lead: match[1], core: match[2], trail: match[3] };
}
