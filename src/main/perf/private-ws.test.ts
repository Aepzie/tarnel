import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePrivateWsReply, PRIVATE_WS_SCRIPT } from './private-ws';

test('parses pid=KB pairs of a helper answer', () => {
  assert.deepEqual([...(parsePrivateWsReply('ok 1234=60340 99=6072\r') ?? [])], [
    [1234, 60340],
    [99, 6072],
  ]);
});

test('an answer with no live pids is an empty map, not a failure', () => {
  assert.equal(parsePrivateWsReply('ok')?.size, 0);
  assert.equal(parsePrivateWsReply('ok \r')?.size, 0);
});

test('ignores lines that are not answers and malformed pairs', () => {
  assert.equal(parsePrivateWsReply('Windows PowerShell'), null);
  assert.equal(parsePrivateWsReply(''), null);
  assert.deepEqual([...(parsePrivateWsReply('ok 1=2 x=3 4= 5=6') ?? [])], [
    [1, 2],
    [5, 6],
  ]);
});

test('helper reads PrivateWorkingSetSize (index 10 of PROCESS_MEMORY_COUNTERS_EX2) and trims itself', () => {
  assert.match(PRIVATE_WS_SCRIPT, /\$buf\[10\]/);
  assert.match(PRIVATE_WS_SCRIPT, /K32EmptyWorkingSet\(\$self\)/);
});
