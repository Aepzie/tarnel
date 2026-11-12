import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import type { FingerprintConfig } from '../shared/fingerprint';
import { protectMainWorld } from './fingerprint-main-world';

/** A minimal DOM-less realm with spec-shaped DOMRectReadOnly / DOMRect / Element / Range stand-ins. */
const FAKE_DOM = `
  class DOMRectReadOnly {
    constructor(x = 0, y = 0, width = 0, height = 0) { this._r = [x, y, width, height]; }
    get x() { return this._r[0]; }
    get y() { return this._r[1]; }
    get width() { return this._r[2]; }
    get height() { return this._r[3]; }
    get top() { return Math.min(this._r[1], this._r[1] + this._r[3]); }
    get right() { return Math.max(this._r[0], this._r[0] + this._r[2]); }
    get bottom() { return Math.max(this._r[1], this._r[1] + this._r[3]); }
    get left() { return Math.min(this._r[0], this._r[0] + this._r[2]); }
    toJSON() {
      const r = this._r;
      return { x: r[0], y: r[1], width: r[2], height: r[3], top: Math.min(r[1], r[1] + r[3]),
        right: Math.max(r[0], r[0] + r[2]), bottom: Math.max(r[1], r[1] + r[3]), left: Math.min(r[0], r[0] + r[2]) };
    }
  }
  class DOMRect extends DOMRectReadOnly {
    get x() { return this._r[0]; } set x(v) { this._r[0] = v; }
    get y() { return this._r[1]; } set y(v) { this._r[1] = v; }
    get width() { return this._r[2]; } set width(v) { this._r[2] = v; }
    get height() { return this._r[3]; } set height(v) { this._r[3] = v; }
  }
  class DOMRectList {
    constructor(rects) { this._rects = rects; for (let i = 0; i < rects.length; i++) this[i] = rects[i]; }
    get length() { return this._rects.length; }
  }
  class Element {
    getBoundingClientRect() { return new DOMRect(1009, 20.5, 300.25, 48); }
    getClientRects() { return new DOMRectList([new DOMRect(8, 16, 100, 20), new DOMRect(8, 36, 64.5, 20)]); }
  }
  class Range extends Element {}
  globalThis.DOMRectReadOnly = DOMRectReadOnly;
  globalThis.DOMRect = DOMRect;
  globalThis.DOMRectList = DOMRectList;
  globalThis.Element = Element;
  globalThis.Range = Range;
`;

const config: FingerprintConfig = { strict: false, key: [0x1234, 0xa5, 0x9abc, 0xdef0], cores: 8, memory: 8, gpu: 0, languages: null };

const protectedRealm = (): vm.Context => {
  const context = vm.createContext({});
  vm.runInContext(FAKE_DOM, context);
  vm.runInContext(`(${protectMainWorld.toString()})(${JSON.stringify(config)})`, context);
  return context;
};

const KEYS = ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'];

test('measured rects: JSON.stringify matches the scaled getters, in native key order', () => {
  const context = protectedRealm();
  const result = vm.runInContext(
    `const rect = new Element().getBoundingClientRect();
     ({ getters: ${JSON.stringify(KEYS)}.map((key) => rect[key]), json: JSON.stringify(rect), raw: rect._r[0] })`,
    context,
  ) as { getters: number[]; json: string; raw: number };
  const parsed = JSON.parse(result.json) as Record<string, number>;
  assert.deepEqual(Object.keys(parsed), KEYS);
  assert.deepEqual(Object.values(parsed), [...result.getters]);
  assert.notEqual(parsed.x, result.raw, 'measured rects are scaled');
});

test('getClientRects items and Range rects are scaled consistently', () => {
  const context = protectedRealm();
  const result = vm.runInContext(
    `const list = new Element().getClientRects();
     const range = new Range().getBoundingClientRect();
     ({
       items: [list[0], list[1], range].map((rect) => ({ x: rect.x, raw: rect._r[0], json: JSON.parse(JSON.stringify(rect)) })),
     })`,
    context,
  ) as { items: { x: number; raw: number; json: Record<string, number> }[] };
  for (const item of result.items) {
    assert.equal(item.json.x, item.x);
    assert.notEqual(item.x, item.raw);
  }
});

test('page-built rects and written rects stay native', () => {
  const context = protectedRealm();
  const result = vm.runInContext(
    `const own = new DOMRect(1009, 2, 3, 4);
     const written = new Element().getBoundingClientRect();
     written.width = 10;
     ({ own: JSON.stringify(own), ownX: own.x, written: JSON.parse(JSON.stringify(written)), writtenX: written.x })`,
    context,
  ) as { own: string; ownX: number; written: Record<string, number>; writtenX: number };
  assert.equal(result.ownX, 1009);
  assert.equal(result.own, '{"x":1009,"y":2,"width":3,"height":4,"top":2,"right":1012,"bottom":6,"left":1009}');
  assert.equal(result.writtenX, 1009);
  assert.equal(result.written.x, 1009);
  assert.equal(result.written.width, 10);
});

test('wrapped toJSON keeps the original source text, name and length', () => {
  const context = protectedRealm();
  const result = vm.runInContext(
    `const toJSON = DOMRectReadOnly.prototype.toJSON;
     ({ source: Function.prototype.toString.call(toJSON), name: toJSON.name, length: toJSON.length,
        inherited: DOMRect.prototype.toJSON === toJSON })`,
    context,
  ) as { source: string; name: string; length: number; inherited: boolean };
  assert.match(result.source, /^toJSON\(\) \{/);
  assert.equal(result.name, 'toJSON');
  assert.equal(result.length, 0);
  assert.equal(result.inherited, true);
});
