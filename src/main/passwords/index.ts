import type { ImportedLogin } from '../../shared/passwords';
import type { SpaceId } from '../../shared/types';

/**
 * Stores imported logins in the Space (encrypted). Existing origin+username pairs are skipped unless the password
 * differs, in which case the imported one wins. Implemented by the password manager feature.
 */
export async function importLogins(spaceId: SpaceId, logins: readonly ImportedLogin[]): Promise<{ added: number; updated: number; skipped: number }> {
  void spaceId;
  void logins;
  throw new Error('The password manager is not available yet.');
}
