import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { isolateScriptlet } from './adblock-scriptlets';

const scriptlet = (name: string): string =>
  `if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; };class JSONPath {}function helper(){return '${name}'}(function main(){ ran.push(helper()) })();`;

test('scriptlets sharing top-level helper declarations all run when isolated', () => {
  const context = vm.createContext({ ran: [] as string[] });
  for (const name of ['a', 'b', 'c']) vm.runInContext(isolateScriptlet(scriptlet(name)), context);
  assert.deepEqual(context.ran, ['a', 'b', 'c']);
  assert.equal(vm.runInContext('typeof helper', context), 'undefined');
  assert.equal(vm.runInContext('typeof scriptletGlobals', context), 'undefined');
});

test('without isolation the second class JSONPath declaration aborts (the bug)', () => {
  const context = vm.createContext({ ran: [] as string[] });
  vm.runInContext(scriptlet('a'), context);
  assert.throws(() => vm.runInContext(scriptlet('b'), context), /JSONPath/);
});

test('a throwing scriptlet does not throw out of the wrapper', () => {
  const context = vm.createContext({});
  assert.doesNotThrow(() => vm.runInContext(isolateScriptlet('throw new Error("boom")'), context));
});
