/**
 * Light language detector for page text: script ranges for non-Latin languages, stop-word hits for
 * Latin ones. Pure and tiny (no model download); used when the page has no usable `lang` attribute
 * and to sanity-check it. Returns null when unsure.
 */

const STOPWORDS: Record<string, string> = {
  en: 'the and of to in is that it for was on are with as be this by have not you from or at which but they his her we an were',
  de: 'der die und das ist nicht ein eine zu den von mit sich des auf für im dem auch es wird sie ich wir bei oder aus nach wie',
  fr: 'le la les et des est une un du en que qui pour dans pas sur au avec ce sont par plus il elle nous vous mais ou',
  es: 'el la los las y de que en un una es por con para del se no al lo como más pero sus fue son está muy',
  it: 'il di che la per un una non sono gli le del della con si è anche come ma dei alla nel questo più',
  nl: 'de het een en van is dat niet op te zijn voor met die er aan ook als bij maar om zich wordt naar',
  pt: 'o a os as e de do da que em um uma é não para com por mais dos das no na se ao foi também',
  pl: 'i w na nie się z do że to jest jak o co ale po od dla przez jego tak już są czy było',
  sv: 'och att det som en på är av för med den till inte har om ett de jag var men kan från',
  da: 'og at det som en på er af for med den til ikke har om et de jeg var men kan fra',
  cs: 'a v se na je že to s z do jako o ale by jsou pro tak jeho jsem není které nebo',
  tr: 've bir bu da de için ile çok ne ama daha olarak gibi olan en kadar sonra değil var',
};

const STOP_SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([lang, words]) => [lang, new Set(words.split(' '))]));

interface ScriptRule {
  lang: string;
  test: RegExp;
}

const SCRIPTS: ScriptRule[] = [
  { lang: 'ja', test: /[぀-ヿ]/g },
  { lang: 'ko', test: /[가-힯]/g },
  { lang: 'zh-Hans', test: /[一-鿿]/g },
  { lang: 'ru', test: /[Ѐ-ӿ]/g },
  { lang: 'el', test: /[Ͱ-Ͽ]/g },
  { lang: 'ar', test: /[؀-ۿ]/g },
  { lang: 'he', test: /[֐-׿]/g },
  { lang: 'th', test: /[฀-๿]/g },
  { lang: 'hi', test: /[ऀ-ॿ]/g },
];

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function cyrillicLang(text: string): string {
  if (count(text, /[іїєґ]/gi) > 2) return 'uk';
  if (count(text, /[ъ]/gi) > 3 && count(text, /[ыэё]/gi) === 0) return 'bg';
  return 'ru';
}

/** Best guess for `text` (a page sample, a few KB is plenty), or null when unsure. */
export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 20_000);
  const letters = count(sample, /\p{L}/gu);
  if (letters < 20) return null;
  const kana = count(sample, /[぀-ヿ]/g);
  for (const rule of SCRIPTS) {
    const hits = count(sample, rule.test);
    if (hits / letters < 0.3) continue;
    if (rule.lang === 'zh-Hans' && kana > 0) return 'ja';
    if (rule.lang === 'ru') return cyrillicLang(sample);
    return rule.lang;
  }
  if (kana / letters > 0.05) return 'ja';
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 8) return null;
  const scores = Object.entries(STOP_SETS).map(([lang, set]) => [lang, words.reduce((sum, word) => sum + (set.has(word) ? 1 : 0), 0)] as const);
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (best[1] / words.length < 0.08) return null;
  if (second && best[1] < second[1] * 1.25) return null;
  return best[0];
}
