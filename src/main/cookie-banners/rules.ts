import fs from 'node:fs';
import path from 'node:path';
import { filterCompactRules, type Config, type IndexedCMPRuleset, type RuleBundle } from '@duckduckgo/autoconsent';

/**
 * Built as its own bundle (dist/main/cookie-banners.js) and only `require`d by
 * src/main/cookie-banners/index.ts when the first web frame asks for rules, so neither the
 * autoconsent rule engine nor the ~550 KB rule list cost anything at startup.
 *
 * The rule list is DuckDuckGo autoconsent's compact-rules.json, copied next to this bundle at build
 * time (scripts/build.mjs). Nothing is fetched at runtime.
 */

export const RULES_FILE = 'cookie-banner-rules.json';

let ruleset: IndexedCMPRuleset | null = null;

function loadRuleset(): IndexedCMPRuleset {
  ruleset ??= JSON.parse(fs.readFileSync(path.join(__dirname, RULES_FILE), 'utf8')) as IndexedCMPRuleset;
  return ruleset;
}

/** Only the rules whose run context can match this frame (generic + frame rules + this URL's site rules). */
export function rulesFor(url: string, mainFrame: boolean): RuleBundle {
  return { autoconsent: [], compact: filterCompactRules(loadRuleset(), { url, mainFrame }) };
}

/**
 * Conservative: opt out via the CMP's own rules (clicks "reject" / "only necessary", or hides the
 * banner when a curated cosmetic rule exists). Heuristic detection of unknown banners stays off —
 * guessing buttons on arbitrary pages is what breaks sites.
 */
export const AUTOCONSENT_CONFIG: Partial<Config> = {
  enabled: true,
  autoAction: 'optOut',
  disabledCmps: [],
  enablePrehide: true,
  enableCosmeticRules: true,
  enableGeneratedRules: true,
  enableHeuristicDetection: false,
  heuristicMode: 'off',
  enablePopupMutationObserver: false,
  detectRetries: 20,
  isMainWorld: false,
  prehideTimeout: 2000,
  visualTest: false,
  performanceLoggingEnabled: false,
  logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false },
};
