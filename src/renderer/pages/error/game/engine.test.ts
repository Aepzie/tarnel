import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, advance, createRun, frame, RESUME_GRACE, SCENE, STALL_GAP } from './engine';

test('a frame gap beyond the stall threshold pauses without advancing, normal and slow frames keep running', () => {
  let run = act(createRun(), 'start');
  for (let i = 0; i < 60; i++) run = frame(run, 1000 / 60, () => 0.5);
  for (let i = 0; i < 30; i++) run = frame(run, 1000 / 30, () => 0.5);
  assert.equal(run.mode, 'running');
  const slow = frame(run, STALL_GAP - 1, () => 0.5);
  assert.equal(slow.mode, 'running');
  assert.ok(slow.distance > run.distance);
  const stalled = frame(run, STALL_GAP + 1, () => 0.5);
  assert.equal(stalled.mode, 'paused');
  assert.deepEqual({ ...stalled, mode: 'running' }, run, 'the stalled frame must not advance the simulation');
  assert.equal(frame(stalled, 16, () => 0.5), stalled);
});

test('resuming clears rocks just ahead of the runner but keeps passed and distant ones', () => {
  const near = { id: 1, x: SCENE.runnerX + SCENE.runnerSize + 10, width: 24, height: 30 };
  const passed = { id: 2, x: SCENE.runnerX - 40, width: 24, height: 30 };
  const far = { id: 3, x: SCENE.width - 10, width: 24, height: 30 };
  const paused = act({ ...act(createRun(), 'start'), obstacles: [near, passed, far] }, 'pause');
  const resumed = act(paused, 'resume');
  assert.equal(resumed.mode, 'running');
  assert.deepEqual(resumed.obstacles.map((rock) => rock.id), [2, 3]);
  let run = resumed;
  for (let elapsed = 0; elapsed < RESUME_GRACE * 1000; elapsed += 16) run = advance(run, 16, () => 0.5);
  assert.equal(run.mode, 'running', 'no collision within the grace window without jumping');
  const clear = act({ ...act(createRun(), 'start'), obstacles: [passed, far] }, 'pause');
  assert.deepEqual(act(clear, 'resume').obstacles, clear.obstacles);
});

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
