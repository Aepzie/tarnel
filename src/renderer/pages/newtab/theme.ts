import type { Settings, SpaceColor } from '@shared/types';
import { applyTheme, velaPages } from '@/lib/vela';

const hasBridge = (): boolean => typeof window.velaPages === 'object' && window.velaPages !== null;

async function resolveAccent(): Promise<SpaceColor | undefined> {
  const space = await velaPages().currentSpace();
  return space?.color;
}

/** Loads settings, applies theme + Space accent, and follows the OS scheme when theme = system. */
export async function bootTheme(): Promise<Settings | null> {
  if (!hasBridge()) return null;
  try {
    const [settings, accent] = await Promise.all([
      velaPages().getSettings(),
      resolveAccent().catch(() => undefined),
    ]);
    applyTheme(settings.theme, accent);
    if (settings.theme === 'system') {
      window
        .matchMedia('(prefers-color-scheme: light)')
        .addEventListener('change', () => applyTheme('system'));
    }
    return settings;
  } catch {
    return null;
  }
}

export { hasBridge };
