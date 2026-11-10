import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { snapBounds, snapZone } from './snap-zone';

const display = { x: 0, y: 0, width: 2560, height: 1440 };
const second = { x: 2560, y: 0, width: 1920, height: 1080 };

describe('snapZone', () => {
  it('top edge maximizes', () => assert.equal(snapZone({ x: 1200, y: 0 }, display), 'maximize'));
  it('left / right edges snap halves', () => {
    assert.equal(snapZone({ x: 0, y: 600 }, display), 'left');
    assert.equal(snapZone({ x: 2559, y: 600 }, display), 'right');
  });
  it('offset displays use their own edges', () => {
    assert.equal(snapZone({ x: 2560, y: 500 }, second), 'left');
    assert.equal(snapZone({ x: 4479, y: 500 }, second), 'right');
  });
  it('anywhere else does nothing', () => assert.equal(snapZone({ x: 1200, y: 600 }, display), null));
});

describe('snapBounds', () => {
  const work = { x: 0, y: 0, width: 2561, height: 1392 };
  it('halves cover the work area exactly', () => {
    const left = snapBounds('left', work);
    const right = snapBounds('right', work);
    assert.deepEqual(left, { x: 0, y: 0, width: 1281, height: 1392 });
    assert.equal(right.x, left.x + left.width);
    assert.equal(left.width + right.width, work.width);
  });
});
