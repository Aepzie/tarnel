import type { CdmComponents } from './controller';

/** ECS strips +wvcus from process.versions.electron. Inspect its API without starting it. */
export function detectCdmComponents(exports: unknown): CdmComponents | null {
  try {
    const api = (exports as { components?: CdmComponents } | null)?.components;
    return api && typeof api.whenReady === 'function' && typeof api.status === 'function' &&
      typeof api.WIDEVINE_CDM_ID === 'string' ? api : null;
  } catch { return null; }
}
