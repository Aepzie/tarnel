import { cleanSiteRules, type SiteRule } from '../../shared/site-rules';
import { createStore, type JsonStore } from '../store';

interface SiteRulesFile {
  rules: SiteRule[];
}

type Listener = (rules: readonly SiteRule[]) => void;

let store: JsonStore<SiteRulesFile> | null = null;
let cached: SiteRule[] | null = null;
const listeners = new Set<Listener>();

function requireStore(): JsonStore<SiteRulesFile> {
  store ??= createStore<SiteRulesFile>('site-rules', { rules: [] });
  return store;
}

export function getSiteRules(): readonly SiteRule[] {
  cached ??= cleanSiteRules(requireStore().get().rules, true);
  return cached;
}

/** Replaces every rule (already validated by the caller). */
export function setSiteRules(rules: SiteRule[]): void {
  cached = rules;
  requireStore().set({ rules });
  for (const listener of listeners) {
    try {
      listener(rules);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function onSiteRulesChanged(listener: Listener): void {
  listeners.add(listener);
}
