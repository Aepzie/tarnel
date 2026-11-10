import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFreezeEligible, pickFreezeTargets, type FreezeCandidate } from './freeze';

const MIN = 60_000;
const NOW = 100 * MIN;

function tab(id: number, idleMin: number, extra: Partial<FreezeCandidate> = {}): FreezeCandidate {
  return { id, lastActiveAt: NOW - idleMin * MIN, audible: false, pinned: false, asleep: false, active: false, frozen: false, downloading: false, ...extra };
}

test('only idle, awake, background, silent, unpinned tabs without downloads are eligible', () => {
  assert.equal(isFreezeEligible(tab(1, 10)), true);
  for (const extra of [{ active: true }, { asleep: true }, { frozen: true }, { audible: true }, { pinned: true }, { downloading: true }]) {
    assert.equal(isFreezeEligible(tab(1, 10, extra)), false, JSON.stringify(extra));
  }
});

test('freezes tabs idle longer than the timeout, oldest first', () => {
  const tabs = [tab(1, 3), tab(2, 9), tab(3, 6), tab(4, 20, { audible: true })];
  assert.deepEqual(pickFreezeTargets(tabs, NOW, 5 * MIN), [2, 3]);
});

test('a zero timeout disables freezing', () => {
  assert.deepEqual(pickFreezeTargets([tab(1, 60)], NOW, 0), []);
});
