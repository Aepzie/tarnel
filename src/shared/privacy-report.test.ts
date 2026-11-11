import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildReport,
  bump,
  dayKey,
  EMPTY_LOG,
  estimateBlockedBytes,
  estimateTimeSavedMs,
  forgetSpace,
  MAX_DOMAINS_PER_DAY,
  mergeLog,
  sanitizeLog,
  shiftDay,
  type PrivacyDay,
} from './privacy-report';
import { trackerCompany } from './tracker-companies';

function pendingOf(fill: (pending: Map<string, PrivacyDay>) => void): PrivacyDay[] {
  const pending = new Map<string, PrivacyDay>();
  fill(pending);
  return [...pending.values()];
}

describe('privacy report days', () => {
  it('formats local days and shifts across month and year ends', () => {
    assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
    assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
    assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
    assert.equal(shiftDay('2026-11-11', -89), '2026-08-14');
  });
});

describe('privacy report aggregation', () => {
  it('bumps totals, Spaces and domains; ignores non-positive amounts', () => {
    const [day] = pendingOf((pending) => {
      bump(pending, '2026-11-11', { counter: 'trackersBlocked', amount: 1, spaceId: 'a', domain: 'doubleclick.net' });
      bump(pending, '2026-11-11', { counter: 'trackersBlocked', amount: 1, spaceId: 'a', domain: 'doubleclick.net' });
      bump(pending, '2026-11-11', { counter: 'trackersBlocked', amount: 1, spaceId: null });
      bump(pending, '2026-11-11', { counter: 'referrersTrimmed', amount: 0, spaceId: 'a' });
      bump(pending, '2026-11-11', { counter: 'referrersTrimmed', amount: Number.NaN, spaceId: 'a' });
    });
    assert.deepEqual(day.total, { trackersBlocked: 3 });
    assert.deepEqual(day.spaces, { a: { trackersBlocked: 2 } });
    assert.deepEqual(day.domains, { 'doubleclick.net': 2 });
  });

  it('merges pending into existing days and keeps unknown counters (one-line extension)', () => {
    const first = mergeLog(EMPTY_LOG, pendingOf((p) => bump(p, '2026-11-10', { counter: 'paramsStripped', amount: 2, spaceId: 'a' })), '2026-11-10');
    const second = mergeLog(
      first,
      pendingOf((p) => {
        bump(p, '2026-11-10', { counter: 'paramsStripped', amount: 3, spaceId: 'a' });
        bump(p, '2026-11-11', { counter: 'cookieBannersHandled', amount: 1, spaceId: 'b' });
      }),
      '2026-11-11',
    );
    assert.deepEqual(second.days.map((d) => d.day), ['2026-11-10', '2026-11-11']);
    assert.equal(second.days[0].total.paramsStripped, 5);
    assert.equal(second.days[0].spaces.a.paramsStripped, 5);
    assert.equal(second.days[1].total.cookieBannersHandled, 1);
    assert.equal(first.days[0].total.paramsStripped, 2, 'mergeLog is pure');
  });

  it('rolls over: drops days older than the retention window and future days', () => {
    const pending = pendingOf((p) => {
      bump(p, '2026-08-13', { counter: 'trackersBlocked', amount: 1, spaceId: null });
      bump(p, '2026-08-14', { counter: 'trackersBlocked', amount: 1, spaceId: null });
      bump(p, '2026-11-12', { counter: 'trackersBlocked', amount: 1, spaceId: null });
    });
    const log = mergeLog(EMPTY_LOG, pending, '2026-11-11');
    assert.deepEqual(log.days.map((d) => d.day), ['2026-08-14']);
  });

  it('caps stored domains per day, keeping the biggest', () => {
    const pending = pendingOf((p) => {
      for (let i = 0; i < MAX_DOMAINS_PER_DAY + 20; i += 1) bump(p, '2026-11-11', { counter: 'trackersBlocked', amount: 1, spaceId: null, domain: `t${i}.com` });
      bump(p, '2026-11-11', { counter: 'trackersBlocked', amount: 1, spaceId: null, domain: 't0.com' });
    });
    const log = mergeLog(EMPTY_LOG, pending, '2026-11-11');
    assert.equal(Object.keys(log.days[0].domains).length, MAX_DOMAINS_PER_DAY);
    assert.equal(log.days[0].domains['t0.com'], 2);
  });

  it('forgets a removed Space but keeps the totals', () => {
    const log = mergeLog(EMPTY_LOG, pendingOf((p) => bump(p, '2026-11-11', { counter: 'trackersBlocked', amount: 4, spaceId: 'gone' })), '2026-11-11');
    const after = forgetSpace(log, 'gone');
    assert.deepEqual(after.days[0].spaces, {});
    assert.equal(after.days[0].total.trackersBlocked, 4);
  });

  it('sanitizes corrupt input', () => {
    const log = sanitizeLog({ days: [{ day: 'nope' }, { day: '2026-11-11', total: { trackersBlocked: 3, bad: 'x', neg: -1 }, spaces: null, domains: { 'a.com': 2 } }, 5] });
    assert.deepEqual(log, { version: 1, days: [{ day: '2026-11-11', total: { trackersBlocked: 3 }, spaces: {}, domains: { 'a.com': 2 } }] });
    assert.deepEqual(sanitizeLog(null), { version: 1, days: [] });
  });
});

describe('privacy report', () => {
  it('compares this week with last week and ranks domains, companies and Spaces', () => {
    const today = '2026-11-11';
    const pending = pendingOf((p) => {
      for (let i = 0; i < 5; i += 1) bump(p, today, { counter: 'trackersBlocked', amount: 1, spaceId: 'work', domain: 'doubleclick.net' });
      for (let i = 0; i < 3; i += 1) bump(p, shiftDay(today, -6), { counter: 'trackersBlocked', amount: 1, spaceId: 'home', domain: 'google-analytics.com' });
      bump(p, shiftDay(today, -2), { counter: 'trackersBlocked', amount: 1, spaceId: 'home', domain: 'unknown-tracker.io' });
      bump(p, shiftDay(today, -7), { counter: 'trackersBlocked', amount: 2, spaceId: 'home', domain: 'criteo.com' });
      bump(p, shiftDay(today, -13), { counter: 'trackersBlocked', amount: 1, spaceId: null });
      bump(p, shiftDay(today, -14), { counter: 'trackersBlocked', amount: 50, spaceId: null });
    });
    const report = buildReport(mergeLog(EMPTY_LOG, pending, today), today, trackerCompany);
    assert.equal(report.thisWeek.trackersBlocked, 9);
    assert.equal(report.lastWeek.trackersBlocked, 3);
    assert.equal(report.allTime.trackersBlocked, 62);
    assert.equal(report.since, shiftDay(today, -14));
    assert.equal(report.daily.length, 14);
    assert.equal(report.daily[13].day, today);
    assert.equal(report.daily[13].trackersBlocked, 5);
    assert.equal(report.daily[0].day, shiftDay(today, -13));
    assert.deepEqual(report.topDomains[0], { domain: 'doubleclick.net', company: 'Google', count: 5 });
    assert.deepEqual(report.topCompanies, [{ company: 'Google', count: 8, domains: 2 }]);
    assert.deepEqual(report.spaces.map((s) => s.spaceId), ['work', 'home']);
  });

  it('is empty without data', () => {
    const report = buildReport(EMPTY_LOG, '2026-11-11', trackerCompany);
    assert.equal(report.since, null);
    assert.deepEqual(report.thisWeek, {});
    assert.equal(report.timeSavedMs.thisWeek, 0);
  });
});

describe('estimates', () => {
  it('estimates blocked bytes by resource type and time saved', () => {
    assert.equal(estimateBlockedBytes('script'), 25_000);
    assert.equal(estimateBlockedBytes('subFrame'), 40_000);
    assert.equal(estimateBlockedBytes(undefined), 2_000);
    assert.equal(estimateTimeSavedMs({ bytesSaved: 1_250_000, trackersBlocked: 100 }), 1000 + 500);
  });

  it('maps tracker domains to companies', () => {
    assert.equal(trackerCompany('DoubleClick.net'), 'Google');
    assert.equal(trackerCompany('media.net'), 'Media.net');
    assert.equal(trackerCompany('example.com'), null);
  });
});
