import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_PAGE_MAX_CSS_HEIGHT,
  parseImageDataUrl,
  planFullPage,
  rectFromPoints,
  scaleRectInto,
  screenshotFileName,
} from './screenshot';

test('planFullPage keeps normal pages at full scale', () => {
  assert.deepEqual(planFullPage(1280, 3000, 1), { width: 1280, height: 3000, scale: 1, truncated: false });
});

test('planFullPage cuts very long pages and shrinks to the image side limit', () => {
  const plan = planFullPage(1280, 50_000, 2);
  assert.equal(plan.height, FULL_PAGE_MAX_CSS_HEIGHT);
  assert.equal(plan.truncated, true);
  assert.ok(plan.height * 2 * plan.scale <= 16_384);
});

test('planFullPage tolerates a bogus device scale', () => {
  assert.equal(planFullPage(800, 600, 0).scale, 1);
});

test('rectFromPoints normalizes any drag direction', () => {
  assert.deepEqual(rectFromPoints(50, 40, 10, 100), { x: 10, y: 40, width: 40, height: 60 });
});

test('scaleRectInto scales and clamps to the image', () => {
  assert.deepEqual(scaleRectInto({ x: -5, y: 10, width: 200, height: 20 }, 2, 300, 300), { x: 0, y: 20, width: 300, height: 40 });
});

test('screenshotFileName has no characters Windows forbids', () => {
  const name = screenshotFileName(new Date(2026, 10, 11, 9, 5, 7), 'png');
  assert.equal(name, 'Tarnel screenshot 2026-11-11 at 09.05.07.png');
  assert.ok(!/[<>:"/\\|?*]/.test(name));
  assert.ok(screenshotFileName(new Date(), 'jpeg').endsWith('.jpg'));
});

test('parseImageDataUrl accepts png/jpeg base64 only', () => {
  assert.deepEqual(parseImageDataUrl('data:image/png;base64,iVBORw0KGgo='), { mime: 'image/png', base64: 'iVBORw0KGgo=' });
  assert.equal(parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(parseImageDataUrl('data:image/png;base64,<script>'), null);
  assert.equal(parseImageDataUrl(42), null);
});
