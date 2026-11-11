import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addArchived, dayKey, dayLabel, groupByDay, relativeAge, removeArchived, searchArchived, type ArchivedTab } from './tab-archive';

function entry(id: string, url: string, archivedAt: number, title = ''): ArchivedTab {
  return { id, spaceId: 's1', url, title, favicon: null, archivedAt, reason: 'manual' };
}

test('addArchived puts new entries first and drops older duplicates of the same URL', () => {
  const list = [entry('a', 'https://a.test/', 10), entry('b', 'https://b.test/', 5)];
  const next = addArchived(list, [entry('c', 'https://b.test/', 20)]);
  assert.deepEqual(next.map((e) => e.id), ['c', 'a']);
});

test('addArchived caps the list, keeping the newest', () => {
  const list = [entry('a', 'https://a.test/', 3), entry('b', 'https://b.test/', 2)];
  const next = addArchived(list, [entry('c', 'https://c.test/', 4)], 2);
  assert.deepEqual(next.map((e) => e.id), ['c', 'a']);
});

test('removeArchived removes by id', () => {
  const list = [entry('a', 'https://a.test/', 3), entry('b', 'https://b.test/', 2)];
  assert.deepEqual(removeArchived(list, new Set(['a'])).map((e) => e.id), ['b']);
});

test('searchArchived matches title and URL case-insensitively', () => {
  const list = [entry('a', 'https://docs.test/', 3, 'Guide'), entry('b', 'https://news.test/', 2, 'Morning News')];
  assert.deepEqual(searchArchived(list, 'news').map((e) => e.id), ['b']);
  assert.deepEqual(searchArchived(list, 'GUIDE').map((e) => e.id), ['a']);
  assert.equal(searchArchived(list, '  ').length, 2);
});

test('groupByDay keeps order and splits on local day', () => {
  const day1 = new Date(2026, 10, 11, 15).getTime();
  const day1b = new Date(2026, 10, 11, 8).getTime();
  const day0 = new Date(2026, 10, 10, 23).getTime();
  const days = groupByDay([entry('a', 'a', day1), entry('b', 'b', day1b), entry('c', 'c', day0)], (e) => e.archivedAt);
  assert.deepEqual(days.map((d) => [d.key, d.entries.map((e) => e.id)]), [
    ['2026-11-11', ['a', 'b']],
    ['2026-11-10', ['c']],
  ]);
});

test('dayLabel names today and yesterday', () => {
  const now = new Date(2026, 10, 11, 12).getTime();
  assert.equal(dayLabel(dayKey(now), now), 'Today');
  assert.equal(dayLabel('2026-11-10', now), 'Yesterday');
  assert.equal(dayLabel('2026-01-02', now), 'Jan 2');
});

test('relativeAge formats minutes, hours and days', () => {
  const now = 10 * 86_400_000;
  assert.equal(relativeAge(now - 10_000, now), 'just now');
  assert.equal(relativeAge(now - 5 * 60_000, now), '5 min ago');
  assert.equal(relativeAge(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(relativeAge(now - 26 * 3_600_000, now), '1 day ago');
  assert.equal(relativeAge(now - 2 * 86_400_000, now), '2 days ago');
});
