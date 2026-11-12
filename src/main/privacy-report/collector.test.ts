import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countBlockedRequest, countPrivacyEvent, drainPrivacyPending, setPrivacyClock, setPrivacyPendingListener, setPrivacySpaceResolver } from './collector';

describe('privacy collector', () => {
  it('attributes to Spaces, keeps burner Spaces out of rows and domains, and splits at midnight', () => {
    let notified = 0;
    setPrivacyPendingListener(() => {
      notified += 1;
    });
    setPrivacySpaceResolver((wcId) => {
      if (wcId === 1) return { spaceId: 'work', ephemeral: false };
      if (wcId === 2) return { spaceId: 'burner', ephemeral: true };
      return null;
    });
    setPrivacyClock(() => new Date(2026, 10, 11, 23, 59, 59).getTime());
    countBlockedRequest(1, 'https://stats.g.doubleclick.net/x.js', 'script');
    countBlockedRequest(1, 'https://stats.g.doubleclick.net/x.js', 'script');
    countBlockedRequest(2, 'https://ads.criteo.com/p', 'image');
    countPrivacyEvent('referrersTrimmed', 1);
    setPrivacyClock(() => new Date(2026, 10, 12, 0, 0, 1).getTime());
    countPrivacyEvent('paramsStripped', 0, 3);

    const days = drainPrivacyPending();
    assert.deepEqual(days.map((d) => d.day), ['2026-11-11', '2026-11-12']);
    const [first, second] = days;
    assert.deepEqual(first.total, { trackersBlocked: 2, bytesSaved: 33_000, referrersTrimmed: 1 });
    assert.deepEqual(first.spaces, { work: { trackersBlocked: 1, bytesSaved: 25_000, referrersTrimmed: 1 } });
    assert.deepEqual(first.domains, { 'doubleclick.net': 1 });
    assert.deepEqual(second.total, { paramsStripped: 3 });
    assert.ok(notified >= 4);
    assert.deepEqual(drainPrivacyPending(), []);
    setPrivacyClock(Date.now);
  });
});
