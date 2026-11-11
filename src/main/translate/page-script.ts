import { segmentText, type TextSegment } from './segment';

/** Isolated world the translator runs in: page scripts can't see or tamper with its state. */
export const TRANSLATE_WORLD_ID = 1777;

export type PageCommand =
  | { op: 'probe' }
  | { op: 'collect' }
  | { op: 'apply'; pairs: [number, string][] }
  | { op: 'restore' }
  | { op: 'reapply' };

export interface PageProbe {
  lang: string;
  sample: string;
  translated: boolean;
}

export type PageReply = PageProbe | [number, string][] | number;

/**
 * Runs inside the page (isolated world). Self-contained: everything it needs comes in as arguments,
 * because it is serialized with Function#toString. Text nodes are replaced in place (markup, event
 * listeners and layout stay intact); the originals are kept so "Show original" is instant.
 */
function pageMain(command: PageCommand, segment: (value: string) => TextSegment | null): PageReply {
  interface Entry {
    node: Text;
    original: string;
    lead: string;
    trail: string;
    translated: string | null;
  }
  interface Store {
    entries: Entry[];
    translated: boolean;
  }
  const scope = globalThis as unknown as { __velaTranslate?: Store };
  const store: Store = scope.__velaTranslate ?? (scope.__velaTranslate = { entries: [], translated: false });
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TEMPLATE', 'SVG', 'MATH', 'INPUT', 'SELECT', 'OPTION']);

  const skipped = (element: Element | null): boolean => {
    for (let current = element; current; current = current.parentElement) {
      if (SKIP.has(current.tagName.toUpperCase())) return true;
      if (current.getAttribute('translate') === 'no' || current.classList.contains('notranslate')) return true;
      if ((current as HTMLElement).isContentEditable) return true;
    }
    return false;
  };

  if (command.op === 'probe') {
    const sample = (document.body?.innerText ?? '').slice(0, 8000);
    return { lang: document.documentElement.lang || document.querySelector('meta[http-equiv="content-language" i]')?.getAttribute('content') || '', sample, translated: store.translated };
  }

  if (command.op === 'collect') {
    const known = new Set(store.entries.map((entry) => entry.node));
    const out: [number, string][] = [];
    if (!document.body) return out;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (known.has(node) || skipped(node.parentElement)) continue;
      const parts = segment(node.nodeValue ?? '');
      if (!parts) continue;
      store.entries.push({ node, original: node.nodeValue ?? '', lead: parts.lead, trail: parts.trail, translated: null });
      out.push([store.entries.length - 1, parts.core]);
    }
    const titleNode = document.head?.querySelector('title')?.firstChild;
    const titleParts = titleNode instanceof Text && !known.has(titleNode) ? segment(titleNode.nodeValue ?? '') : null;
    if (titleNode instanceof Text && titleParts) {
      store.entries.push({ node: titleNode, original: titleNode.nodeValue ?? '', lead: titleParts.lead, trail: titleParts.trail, translated: null });
      out.push([store.entries.length - 1, titleParts.core]);
    }
    return out;
  }

  if (command.op === 'apply') {
    for (const [index, text] of command.pairs) {
      const entry = store.entries[index];
      if (!entry || entry.node.nodeValue !== entry.original) continue;
      entry.translated = entry.lead + text + entry.trail;
      entry.node.nodeValue = entry.translated;
    }
    store.translated = true;
    return command.pairs.length;
  }

  if (command.op === 'restore') {
    let restored = 0;
    for (const entry of store.entries) {
      if (entry.translated === null || entry.node.nodeValue !== entry.translated) continue;
      entry.node.nodeValue = entry.original;
      restored++;
    }
    store.translated = false;
    return restored;
  }

  let reapplied = 0;
  for (const entry of store.entries) {
    if (entry.translated === null || entry.node.nodeValue !== entry.original) continue;
    entry.node.nodeValue = entry.translated;
    reapplied++;
  }
  store.translated = reapplied > 0;
  return reapplied;
}

export function pageCode(command: PageCommand): string {
  return `(${pageMain.toString()})(${JSON.stringify(command)}, ${segmentText.toString()})`;
}
