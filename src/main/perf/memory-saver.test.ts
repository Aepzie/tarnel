import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateTabMemoryKB, pickSaverTargets, type SaverCandidate } from './memory-saver';

const MIN = 60_000;
const NOW = 100 * MIN;
const GB = 1024 * 1024;

function tab(id: number, idleMin: number, memoryKB: number, extra: Partial<SaverCandidate> = {}): SaverCandidate {
  return { id, lastActiveAt: NOW - idleMin * MIN, audible: false, pinned: false, asleep: false, active: false, downloading: false, memoryKB, ...extra };
}

test('does nothing when off or under the threshold', () => {
  const tabs = [tab(1, 30, GB)];
  assert.deepEqual(pickSaverTargets(tabs, NOW, 'off', 5 * GB, 4 * GB), []);
  assert.deepEqual(pickSaverTargets(tabs, NOW, 'balanced', 3 * GB, 4 * GB), []);
});

test('sleeps least recently used tabs until the estimate is under the threshold', () => {
  const tabs = [tab(1, 10, 0.3 * GB), tab(2, 40, 0.4 * GB), tab(3, 20, 0.5 * GB), tab(4, 60, 0.2 * GB, { pinned: true })];
  assert.deepEqual(pickSaverTargets(tabs, NOW, 'balanced', 4.5 * GB, 4 * GB), [2, 3]);
  assert.deepEqual(pickSaverTargets(tabs, NOW, 'balanced', 4.2 * GB, 4 * GB), [2]);
});

test('skips ineligible tabs and respects the per-tick cap and idle minimum', () => {
  const tabs = [
    tab(1, 30, 0.1 * GB, { audible: true }),
    tab(2, 30, 0.1 * GB, { active: true }),
    tab(3, 30, 0.1 * GB, { downloading: true }),
    tab(4, 30, 0.1 * GB),
    tab(5, 29, 0.1 * GB),
    tab(6, 28, 0.1 * GB),
    tab(7, 1, 0.1 * GB),
  ];
  assert.deepEqual(pickSaverTargets(tabs, NOW, 'balanced', 10 * GB, 4 * GB), [4, 5]);
  assert.deepEqual(pickSaverTargets(tabs, NOW, 'maximum', 10 * GB, 4 * GB), [4, 5, 6, 7]);
});

test('splits a shared renderer between the tabs it hosts', () => {
  const estimate = estimateTabMemoryKB(
    new Map([
      [1, [10, 11]],
      [2, [10]],
    ]),
    new Map([
      [10, 400],
      [11, 100],
    ]),
  );
  assert.deepEqual([...estimate], [
    [1, 300],
    [2, 200],
  ]);
});
