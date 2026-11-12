import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, advance, createRun } from './engine';

test('a run waits for explicit start and paused or finished runs do not advance', () => {
  const ready = createRun();
  assert.equal(ready.mode, 'ready');
  assert.equal(advance(ready, 30, () => 0), ready);
  const running = act(ready, 'start');
  assert.equal(running.mode, 'running');
  assert.ok(advance(running, 30, () => 0).distance > 0);
  const paused = act(running, 'pause');
  assert.equal(advance(paused, 30, () => 0), paused);
  assert.equal(act(paused, 'jump'), paused);
  assert.equal(act(paused, 'resume').mode, 'running');
});

test('jumping clears a low obstacle, cannot double jump, and lands on the ground', () => {
  let run = act(act(createRun(), 'start'), 'jump');
  assert.equal(act(run, 'jump'), run);
  for (let i = 0; i < 16; i++) run = advance(run, 16, () => 0);
  assert.ok(run.height > 40);
  const airborne = advance({ ...run, obstacles: [{ id: 1, x: 70, width: 24, height: 30 }] }, 16, () => 0);
  assert.equal(airborne.mode, 'running');
  for (let i = 0; i < 40; i++) run = advance(run, 16, () => 0);
  assert.equal(run.height, 0);
  assert.equal(run.velocity, 0);
});

test('ground collision ends the run and restart clears the old course and score', () => {
  const hit = advance({ ...act(createRun(), 'start'), distance: 500, obstacles: [{ id: 1, x: 70, width: 24, height: 30 }] }, 16, () => 0);
  assert.equal(hit.mode, 'over');
  assert.equal(advance(hit, 100, () => 0), hit);
  const restarted = act(hit, 'start');
  assert.equal(restarted.mode, 'running');
  assert.equal(restarted.distance, 0);
  assert.equal(restarted.score, 0);
  assert.deepEqual(restarted.obstacles, []);
});

test('invalid timings are ignored and a stalled frame cannot fast-forward gameplay', () => {
  const run = act(createRun(), 'start');
  for (const elapsed of [-1, 0, NaN, Infinity]) assert.equal(advance(run, elapsed, () => 0), run);
  const delayed = advance(run, 60_000, () => 0);
  assert.ok(delayed.distance > 0 && delayed.distance < 20);
  assert.equal(delayed.mode, 'running');
});

test('score advances with distance while obstacle generation remains spaced and bounded', () => {
  let run = act(createRun(), 'start');
  for (let i = 0; i < 90; i++) run = advance(run, 16, () => 0.5);
  assert.ok(run.score > 0);
  assert.equal(run.obstacles.length, 1);
  assert.ok(run.obstacles[0]!.x > 300);
  const original = structuredClone(run);
  advance(run, 16, () => 0);
  assert.deepEqual(run, original, 'simulation must not mutate the previous render state');
});
