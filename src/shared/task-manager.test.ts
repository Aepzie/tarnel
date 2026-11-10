import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTaskSnapshot, matchWorkerPids, sortTaskRows, type ProcessSample, type TabSample } from './task-manager';

const proc = (pid: number, type: string, cpuPercent: number, memoryMB: number, extra: Partial<ProcessSample> = {}): ProcessSample => ({
  pid,
  type,
  cpuPercent,
  memoryKB: memoryMB * 1024,
  creationTime: pid,
  ...extra,
});

const tab = (id: number, pids: number[], extra: Partial<TabSample> = {}): TabSample => ({
  id,
  title: `Tab ${id}`,
  favicon: null,
  spaceColor: 'blue',
  state: 'background',
  pids,
  ...extra,
});

test('maps renderer pids to tabs, including out-of-process iframes', () => {
  const snapshot = buildTaskSnapshot({
    processes: [proc(1, 'Browser', 2, 100), proc(10, 'Tab', 5, 200), proc(11, 'Tab', 1, 50), proc(2, 'GPU', 3, 80)],
    tabs: [tab(1, [10, 11])],
    extensions: [],
    interfacePids: [],
  });
  const row = snapshot.rows.find((r) => r.tabId === 1);
  assert.equal(row?.cpuPercent, 6);
  assert.equal(row?.memoryMB, 250);
  assert.equal(row?.shared, false);
  assert.deepEqual(
    snapshot.rows.map((r) => r.kind),
    ['tab', 'browser', 'gpu'],
  );
});

test('shared renderers are flagged per row but counted once in totals', () => {
  const snapshot = buildTaskSnapshot({
    processes: [proc(10, 'Tab', 4, 300)],
    tabs: [tab(1, [10]), tab(2, [10])],
    extensions: [],
    interfacePids: [],
  });
  assert.ok(snapshot.rows.every((r) => r.shared && r.memoryMB === 300));
  assert.equal(snapshot.totals.memoryMB, 300);
  assert.equal(snapshot.totals.processes, 1);
});

test('asleep tabs have no metrics; the interface renderer gets its own row', () => {
  const snapshot = buildTaskSnapshot({
    processes: [proc(10, 'Tab', 0, 40), proc(20, 'Tab', 1, 90)],
    tabs: [tab(1, [10], { state: 'asleep' })],
    extensions: [],
    interfacePids: [20],
  });
  const asleep = snapshot.rows.find((r) => r.tabId === 1);
  assert.equal(asleep?.memoryMB, null);
  assert.equal(snapshot.rows.find((r) => r.kind === 'interface')?.memoryMB, 90);
  assert.equal(snapshot.rows.find((r) => r.kind === 'renderer')?.pids[0], 10);
});

test('utility processes get readable names', () => {
  const snapshot = buildTaskSnapshot({
    processes: [proc(3, 'Utility', 0, 10, { serviceName: 'network.mojom.NetworkService', name: 'Network Service' }), proc(4, 'Utility', 0, 5, { name: 'audio service' })],
    tabs: [],
    extensions: [],
    interfacePids: [],
  });
  assert.deepEqual(
    snapshot.rows.map((r) => r.title),
    ['Network service', 'Audio service'],
  );
});

test('extension workers are matched to unowned renderers only when the counts agree', () => {
  const unowned = [proc(31, 'Tab', 0, 30, { creationTime: 200 }), proc(30, 'Tab', 0, 20, { creationTime: 100 })];
  assert.deepEqual([...matchWorkerPids(unowned, [7, 9])], [[7, 30], [9, 31]]);
  assert.equal(matchWorkerPids(unowned, [7]).size, 0);

  const snapshot = buildTaskSnapshot({
    processes: unowned,
    tabs: [],
    extensions: [
      { id: 'a', name: 'Alpha', icon: null, pids: [], workerProcessIds: [7] },
      { id: 'b', name: 'Beta', icon: null, pids: [], workerProcessIds: [9] },
    ],
    interfacePids: [],
  });
  assert.equal(snapshot.rows.find((r) => r.title === 'Alpha')?.memoryMB, 20);
  assert.equal(snapshot.rows.find((r) => r.title === 'Beta')?.memoryMB, 30);
  assert.ok(!snapshot.rows.some((r) => r.kind === 'renderer'));
});

test('sorting keeps rows without metrics last', () => {
  const snapshot = buildTaskSnapshot({
    processes: [proc(10, 'Tab', 1, 100), proc(11, 'Tab', 9, 50)],
    tabs: [tab(1, [10]), tab(2, [11]), tab(3, [], { state: 'asleep' })],
    extensions: [],
    interfacePids: [],
  });
  assert.deepEqual(
    sortTaskRows(snapshot.rows, 'memory', true).map((r) => r.tabId),
    [1, 2, 3],
  );
  assert.deepEqual(
    sortTaskRows(snapshot.rows, 'cpu', false).map((r) => r.tabId),
    [1, 2, 3],
  );
});
