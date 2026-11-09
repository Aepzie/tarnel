import { NEWTAB_HEROES, type NewtabHero } from '@shared/types';

export const HERO_LABELS: Record<NewtabHero, string> = {
  clock: 'Clock',
  'clock-seconds': 'Clock with seconds',
  logo: 'Vela logo',
  date: 'Date',
  greeting: 'Greeting',
  minimal: 'Minimal',
};

export const isNewtabHero = (value: unknown): value is NewtabHero =>
  typeof value === 'string' && (NEWTAB_HEROES as readonly string[]).includes(value);

export const nextHero = (current: NewtabHero): NewtabHero =>
  NEWTAB_HEROES[(NEWTAB_HEROES.indexOf(current) + 1) % NEWTAB_HEROES.length]!;

/** Hero applied synchronously by the preload before first paint (no flash of the default style). */
export const bootHero = (): NewtabHero | null => {
  const value = document.documentElement.dataset.hero;
  return isNewtabHero(value) ? value : null;
};
