import { app } from 'electron';
import { cpSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_PROFILE_DIR, planUserDataMigration, userDataOverride } from './plan';

function list(dir: string): string[] | null {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
}

/**
 * Moves `from` to `to`: a rename when possible (same volume, nothing locked), otherwise a copy into
 * a sibling staging directory that is renamed into place only once it is complete. The old profile
 * is never deleted by the copy path, and nothing but the staging copy is removed on failure.
 */
function moveProfile(from: string, to: string): boolean {
  // `to` holds no user data at this point (plan checked it): only startup leftovers like compile-cache.
  try {
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  } catch {
    return false;
  }
  try {
    renameSync(from, to);
    return true;
  } catch (error) {
    // Locked (an old Vela still running, a scanner holding a file): copying a live profile could
    // tear its databases, so keep using it in place and try again next start.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return false;
  }
  const staging = `${to}.migrating`;
  try {
    rmSync(staging, { recursive: true, force: true });
    cpSync(from, staging, { recursive: true, preserveTimestamps: true, errorOnExist: false });
    renameSync(staging, to);
    return true;
  } catch {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      /* a leftover staging copy is harmless; the next attempt clears it */
    }
    return false;
  }
}

/**
 * Settles app.getPath('userData') before anything touches it (boot.ts, before the single-instance
 * lock and before 'ready'): TARNEL_USER_DATA / VELA_USER_DATA, else the Tarnel directory, migrated
 * from a pre-rename Vela profile on first start. If that migration fails the old directory is used
 * as is for this run, so no data is lost and the next start tries again.
 */
export function resolveUserData(): void {
  const override = userDataOverride(process.env);
  if (override) {
    app.setPath('userData', override);
    return;
  }
  try {
    const target = app.getPath('userData');
    const legacy = join(app.getPath('appData'), LEGACY_PROFILE_DIR);
    const plan = planUserDataMigration({
      override,
      target,
      targetEntries: list(target),
      legacy,
      legacyEntries: list(legacy),
    });
    if (plan.action !== 'migrate') return;
    if (!moveProfile(plan.from, plan.to) && existsSync(plan.from)) app.setPath('userData', plan.from);
  } catch {
    /* keep Electron's default userData */
  }
}
