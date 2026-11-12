import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ARCHIVE_PER_TICK, archiveAfterMs, isArchivable, pickArchiveTargets, type ArchiveCandidate } from './policy';

const HOUR = 3_600_000;
const now = 1_000 * HOUR;

function tab(id: number, idleHours: number, extra: Partial<ArchiveCandidate> = {}): ArchiveCandidate {
  return {
    id,
    url: `https://example.com/${id}`,
    lastActiveAt: now - idleHours * HOUR,
    pinned: false,
    active: false,
    audible: false,
    capturing: false,
    downloading: false,
    ...extra,
  };
}

test('picks tabs idle at least the threshold, oldest first', () => {
  const tabs = [tab(1, 30), tab(2, 23), tab(3, 48), tab(4, 24)];
  assert.deepEqual(pickArchiveTargets(tabs, now, 24 * HOUR), [3, 1, 4]);
});

test('off when the threshold is 0 or invalid', () => {
  assert.deepEqual(pickArchiveTargets([tab(1, 1000)], now, 0), []);
  assert.deepEqual(pickArchiveTargets([tab(1, 1000)], now, Number.NaN), []);
});

test('never archives pinned, on-screen, audible, capturing or downloading tabs', () => {
  const tabs = [
    tab(1, 99, { pinned: true }),
    tab(2, 99, { active: true }),
    tab(3, 99, { audible: true }),
    tab(4, 99, { capturing: true }),
    tab(5, 99, { downloading: true }),
    tab(6, 99),
  ];
  assert.deepEqual(pickArchiveTargets(tabs, now, HOUR), [6]);
});

test('start pages are not archived', () => {
  assert.equal(isArchivable(tab(1, 99, { url: 'tarnel://newtab/' })), false);
  assert.equal(isArchivable(tab(1, 99, { url: 'tarnel://history/' })), true);
});

test('caps the number of tabs per check', () => {
  const tabs = Array.from({ length: MAX_ARCHIVE_PER_TICK + 10 }, (_, i) => tab(i + 1, 50 + i));
  const picked = pickArchiveTargets(tabs, now, HOUR);
  assert.equal(picked.length, MAX_ARCHIVE_PER_TICK);
  assert.equal(picked[0], MAX_ARCHIVE_PER_TICK + 10);
});

test('archiveAfterMs converts hours and treats non-positive as off', () => {
  assert.equal(archiveAfterMs(24), 24 * HOUR);
  assert.equal(archiveAfterMs(0), 0);
  assert.equal(archiveAfterMs(-3), 0);
});
