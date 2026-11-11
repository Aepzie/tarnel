/**
 * On-device page translation contract shared by main (engine, model store), the chrome UI (palette
 * offer + command) and vela://settings (Languages). Pure: no electron imports.
 * See docs/ARCHITECTURE.md → Translation.
 */

export const TRANSLATE_IPC = {
  /** chrome: per-tab translation state of a tab. */
  tabState: 'chrome:translate-tab-state',
  /** chrome: translate a tab into the target language (or `to` when given). */
  translateTab: 'chrome:translate-tab',
  /** chrome: restore the original text of a translated tab. */
  showOriginal: 'chrome:translate-show-original',
  /** chrome-event: TranslateTabState whenever a tab's translation state changes. */
  tabChanged: 'chrome-event:translate-tab',
  /** pages (vela://settings): languages, prefs and installed models. */
  overview: 'pages:translate-overview',
  setPrefs: 'pages:translate-set-prefs',
  deleteModel: 'pages:translate-delete-model',
  refreshCatalog: 'pages:translate-refresh-catalog',
} as const;

export type TranslatePhase = 'idle' | 'downloading' | 'translating' | 'translated' | 'error';

export interface TranslateTabState {
  tabId: number;
  /** Detected page language (BCP-47 base, e.g. "en"), null when unknown. */
  pageLang: string | null;
  /** Language the page would be translated into. */
  targetLang: string;
  /** A model path page→target exists in the catalog (directly or via English). */
  available: boolean;
  phase: TranslatePhase;
  /** 0..1 while downloading models or translating. */
  progress: number;
  /** Language the page is currently shown in (when translated). */
  shownLang: string | null;
  error: string | null;
}

export interface TranslatePrefs {
  /** Language pages are translated into. */
  targetLang: string;
  /** Source languages that are translated automatically when a page loads. */
  alwaysTranslate: string[];
  /** Show the translate offer in the address popup when the page language differs. */
  offer: boolean;
}

export interface InstalledModel {
  /** "en-de" */
  pair: string;
  from: string;
  to: string;
  version: string;
  bytes: number;
}

export interface TranslateOverview {
  prefs: TranslatePrefs;
  /** Every language that can be a target (and its display name). */
  languages: { code: string; name: string }[];
  /** Direct pairs Mozilla publishes, e.g. ["de-en", "en-de", …]. Empty until the catalog was fetched once. */
  pairs: string[];
  installed: InstalledModel[];
}

export const DEFAULT_TRANSLATE_PREFS: TranslatePrefs = { targetLang: 'en', alwaysTranslate: [], offer: true };

const LANGUAGE_NAMES: Record<string, string> = {
  af: 'Afrikaans', ar: 'Arabic', az: 'Azerbaijani', be: 'Belarusian', bg: 'Bulgarian', bn: 'Bengali', bs: 'Bosnian',
  ca: 'Catalan', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English', es: 'Spanish', et: 'Estonian',
  eu: 'Basque', fa: 'Persian', fi: 'Finnish', fr: 'French', gl: 'Galician', gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi',
  hr: 'Croatian', hu: 'Hungarian', id: 'Indonesian', is: 'Icelandic', it: 'Italian', ja: 'Japanese', kn: 'Kannada',
  ko: 'Korean', lt: 'Lithuanian', lv: 'Latvian', ml: 'Malayalam', mr: 'Marathi', ms: 'Malay', mt: 'Maltese',
  nb: 'Norwegian Bokmål', nl: 'Dutch', nn: 'Norwegian Nynorsk', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian',
  ru: 'Russian', sk: 'Slovak', sl: 'Slovenian', sq: 'Albanian', sr: 'Serbian', sv: 'Swedish', ta: 'Tamil',
  te: 'Telugu', th: 'Thai', tl: 'Tagalog', tr: 'Turkish', ug: 'Uyghur', uk: 'Ukrainian', ur: 'Urdu',
  vi: 'Vietnamese', 'zh-Hans': 'Chinese (Simplified)', 'zh-Hant': 'Chinese (Traditional)',
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/** Language codes Vela knows a display name for (the catalog decides what is actually available). */
export function knownLanguages(): string[] {
  return Object.keys(LANGUAGE_NAMES);
}

/** "de-DE" → "de", "zh-TW" → "zh-Hant", "zh" → "zh-Hans", "no" → "nb"; null for empty/invalid tags. */
export function normalizeLang(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const parts = tag.trim().replace(/_/g, '-').split('-').filter(Boolean);
  const base = parts[0]?.toLowerCase();
  if (!base || !/^[a-z]{2,3}$/.test(base)) return null;
  if (base === 'zh') {
    const rest = parts.slice(1).map((part) => part.toLowerCase());
    return rest.includes('hant') || rest.includes('tw') || rest.includes('hk') || rest.includes('mo') ? 'zh-Hant' : 'zh-Hans';
  }
  if (base === 'no') return 'nb';
  if (base === 'iw') return 'he';
  if (base === 'fil') return 'tl';
  return base;
}
