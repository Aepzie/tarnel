import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isShiftClickOpen, peekGeometry, peekHost, PEEK_TOOLBAR } from './peek';

test('card covers ~80 % of the page area, centred', () => {
  const { card, view } = peekGeometry({ x: 100, y: 50, width: 1000, height: 800 });
  assert.deepEqual(card, { x: 200, y: 130, width: 800, height: 640 });
  assert.deepEqual(view, { x: 200, y: 130 + PEEK_TOOLBAR, width: 800, height: 640 - PEEK_TOOLBAR });
});

test('small page areas keep a usable card but never overflow', () => {
  const { card } = peekGeometry({ x: 0, y: 0, width: 300, height: 200 });
  assert.deepEqual(card, { x: 0, y: 0, width: 300, height: 200 });
});

test('shift-click is new-window without features', () => {
  assert.equal(isShiftClickOpen('new-window', ''), true);
  assert.equal(isShiftClickOpen('new-window', 'width=400,height=300'), false);
  assert.equal(isShiftClickOpen('foreground-tab', ''), false);
  assert.equal(isShiftClickOpen('background-tab', ''), false);
});

test('host strips www and falls back to the raw text', () => {
  assert.equal(peekHost('https://www.example.com/a?b'), 'example.com');
  assert.equal(peekHost('http://localhost:8080/'), 'localhost:8080');
  assert.equal(peekHost('not a url'), 'not a url');
});
