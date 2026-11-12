import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badgeFromTitle, clampPanelWidth, normalizePanelUrl, panelIdleAction, panelNameFor, panelNextDeadline, type PanelIdleCandidate } from './panels';

const MIN = 60_000;
const NOW = 1_000 * MIN;

function panel(collapsedMinAgo: number | null, extra: Partial<PanelIdleCandidate> = {}): PanelIdleCandidate {
  return { collapsedAt: collapsedMinAgo === null ? null : NOW - collapsedMinAgo * MIN, loaded: true, frozen: false, audible: false, ...extra };
}

test('badge counts come from the page title', () => {
  assert.equal(badgeFromTitle('(3) WhatsApp'), 3);
  assert.equal(badgeFromTitle('[12] Discord'), 12);
  assert.equal(badgeFromTitle('Inbox (5)'), 5);
  assert.equal(badgeFromTitle('(99+) Chat'), 99);
  assert.equal(badgeFromTitle('WhatsApp'), 0);
  assert.equal(badgeFromTitle('Version (beta) notes'), 0);
  assert.equal(badgeFromTitle(''), 0);
});

test('panel URLs are normalised to http(s) only', () => {
  assert.equal(normalizePanelUrl('web.whatsapp.com'), 'https://web.whatsapp.com/');
  assert.equal(normalizePanelUrl(' https://discord.com/app '), 'https://discord.com/app');
  assert.equal(normalizePanelUrl('localhost:8080/chat'), 'https://localhost:8080/chat');
  assert.equal(normalizePanelUrl('http://127.0.0.1:5000/'), 'http://127.0.0.1:5000/');
  assert.equal(normalizePanelUrl('javascript:alert(1)'), null);
  assert.equal(normalizePanelUrl('file:///C:/x'), null);
  assert.equal(normalizePanelUrl('tarnel://settings'), null);
  assert.equal(normalizePanelUrl('two words'), null);
  assert.equal(normalizePanelUrl(''), null);
});

test('names and widths', () => {
  assert.equal(panelNameFor('https://www.notion.so/x'), 'notion.so');
  assert.equal(clampPanelWidth(100), 300);
  assert.equal(clampPanelWidth(5000), 900);
  assert.equal(clampPanelWidth(Number.NaN), 420);
});

test('idle policy: freeze, then sleep, never while open, audible or unloaded', () => {
  const freeze = 5 * MIN;
  const sleep = 10 * MIN;
  assert.equal(panelIdleAction(panel(null), NOW, freeze, sleep), null);
  assert.equal(panelIdleAction(panel(2), NOW, freeze, sleep), null);
  assert.equal(panelIdleAction(panel(6), NOW, freeze, sleep), 'freeze');
  assert.equal(panelIdleAction(panel(6, { frozen: true }), NOW, freeze, sleep), null);
  assert.equal(panelIdleAction(panel(11, { frozen: true }), NOW, freeze, sleep), 'sleep');
  assert.equal(panelIdleAction(panel(60, { audible: true }), NOW, freeze, sleep), null);
  assert.equal(panelIdleAction(panel(60, { loaded: false }), NOW, freeze, sleep), null);
  assert.equal(panelIdleAction(panel(60), NOW, 0, 0), null);
  assert.equal(panelIdleAction(panel(60), NOW, freeze, 0), 'freeze');
  assert.equal(panelIdleAction(panel(6), NOW, 20 * MIN, sleep), null);
});

test('next deadline drives a single timer', () => {
  const freeze = 5 * MIN;
  const sleep = 10 * MIN;
  assert.equal(panelNextDeadline(panel(2), NOW, freeze, sleep), 3 * MIN);
  assert.equal(panelNextDeadline(panel(6, { frozen: true }), NOW, freeze, sleep), 4 * MIN);
  assert.equal(panelNextDeadline(panel(null), NOW, freeze, sleep), null);
  assert.equal(panelNextDeadline(panel(2), NOW, 0, 0), null);
  assert.equal(panelNextDeadline(panel(12, { frozen: true }), NOW, freeze, sleep), 0);
});
