import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOOKMARK_ROOTS } from '../../shared/bookmarks-ipc';
import type { BookmarkNode } from '../../shared/bookmarks';
import { addNode, childrenOf, cleanUrl, findByUrl, importNodes, normalizeTree, removeNode, searchNodes, updateNode } from './tree';

const SPACE = 'space-a';
const { bar, other } = BOOKMARK_ROOTS;

function titles(nodes: readonly BookmarkNode[], parentId: string): string[] {
  return childrenOf(nodes, parentId).map((node) => node.title);
}

function seed(): BookmarkNode[] {
  let nodes = normalizeTree(SPACE, []);
  for (const title of ['A', 'B', 'C']) nodes = addNode(nodes, SPACE, { parentId: bar, kind: 'bookmark', title, url: `https://${title.toLowerCase()}.test/` }).nodes;
  return nodes;
}

describe('normalizeTree', () => {
  it('creates both root folders for an empty Space', () => {
    const nodes = normalizeTree(SPACE, undefined);
    assert.deepEqual(childrenOf(nodes, null).map((node) => node.id), [bar, other]);
  });
  it('drops orphans, cycles, bad urls and duplicate ids', () => {
    const raw = [
      { id: 'a', parentId: bar, kind: 'bookmark', title: 'ok', url: 'https://ok.test/', index: 0, addedAt: 1 },
      { id: 'a', parentId: bar, kind: 'bookmark', title: 'dup', url: 'https://dup.test/', index: 1, addedAt: 1 },
      { id: 'b', parentId: 'missing', kind: 'bookmark', title: 'orphan', url: 'https://x.test/', index: 0, addedAt: 1 },
      { id: 'c', parentId: bar, kind: 'bookmark', title: 'js', url: 'javascript:alert(1)', index: 2, addedAt: 1 },
      { id: 'd', parentId: 'e', kind: 'folder', title: 'loop1', index: 0, addedAt: 1 },
      { id: 'e', parentId: 'd', kind: 'folder', title: 'loop2', index: 0, addedAt: 1 },
      { id: bar, parentId: null, kind: 'folder', title: 'fake root', index: 5, addedAt: 1 },
    ];
    const nodes = normalizeTree(SPACE, raw);
    assert.deepEqual(nodes.filter((node) => node.parentId !== null).map((node) => node.id), ['a']);
    assert.equal(nodes.find((node) => node.id === bar)?.title, 'Bookmarks bar');
  });
});

describe('addNode', () => {
  it('appends by default and inserts at an index', () => {
    const nodes = addNode(seed(), SPACE, { parentId: bar, kind: 'bookmark', title: 'Z', url: 'https://z.test/', index: 1 }).nodes;
    assert.deepEqual(titles(nodes, bar), ['A', 'Z', 'B', 'C']);
    assert.deepEqual(childrenOf(nodes, bar).map((node) => node.index), [0, 1, 2, 3]);
  });
  it('rejects unsafe urls and unknown parents', () => {
    assert.throws(() => addNode(seed(), SPACE, { parentId: bar, kind: 'bookmark', title: 'x', url: 'javascript:void(0)' }));
    assert.throws(() => addNode(seed(), SPACE, { parentId: 'nope', kind: 'folder', title: 'x' }));
  });
  it('uses the url as title when empty', () => {
    const { node } = addNode(seed(), SPACE, { parentId: other, kind: 'bookmark', title: '  ', url: 'https://t.test' });
    assert.equal(node.title, 'https://t.test/');
  });
});

describe('updateNode', () => {
  it('renames and changes url without moving', () => {
    const nodes = seed();
    const b = childrenOf(nodes, bar)[1]!;
    const next = updateNode(nodes, b.id, { title: 'Bee', url: 'https://bee.test/' });
    assert.deepEqual(titles(next, bar), ['A', 'Bee', 'C']);
    assert.equal(next.find((node) => node.id === b.id)?.url, 'https://bee.test/');
  });
  it('reorders within a folder using pre-move drop positions', () => {
    const nodes = seed();
    const [a, , c] = childrenOf(nodes, bar);
    assert.deepEqual(titles(updateNode(nodes, a!.id, { index: 3 }), bar), ['B', 'C', 'A']);
    assert.deepEqual(titles(updateNode(nodes, a!.id, { index: 2 }), bar), ['B', 'A', 'C']);
    assert.deepEqual(titles(updateNode(nodes, c!.id, { index: 0 }), bar), ['C', 'A', 'B']);
  });
  it('moves between folders and reindexes both', () => {
    const nodes = seed();
    const b = childrenOf(nodes, bar)[1]!;
    const next = updateNode(nodes, b.id, { parentId: other });
    assert.deepEqual(titles(next, bar), ['A', 'C']);
    assert.deepEqual(childrenOf(next, bar).map((node) => node.index), [0, 1]);
    assert.deepEqual(titles(next, other), ['B']);
  });
  it('refuses to move a folder into its own descendant or touch roots', () => {
    let nodes = seed();
    const outer = addNode(nodes, SPACE, { parentId: bar, kind: 'folder', title: 'Outer' });
    nodes = outer.nodes;
    const inner = addNode(nodes, SPACE, { parentId: outer.node.id, kind: 'folder', title: 'Inner' });
    nodes = inner.nodes;
    assert.throws(() => updateNode(nodes, outer.node.id, { parentId: inner.node.id }));
    assert.throws(() => updateNode(nodes, outer.node.id, { parentId: outer.node.id }));
    assert.throws(() => updateNode(nodes, bar, { title: 'x' }));
  });
  it('does not mutate its input', () => {
    const nodes = seed();
    const snapshot = JSON.stringify(nodes);
    updateNode(nodes, childrenOf(nodes, bar)[0]!.id, { parentId: other, title: 'moved' });
    assert.equal(JSON.stringify(nodes), snapshot);
  });
});

describe('removeNode', () => {
  it('removes a folder with everything inside', () => {
    let nodes = seed();
    const folder = addNode(nodes, SPACE, { parentId: bar, kind: 'folder', title: 'F', index: 0 });
    nodes = addNode(folder.nodes, SPACE, { parentId: folder.node.id, kind: 'bookmark', title: 'inside', url: 'https://in.test/' }).nodes;
    const next = removeNode(nodes, folder.node.id);
    assert.deepEqual(titles(next, bar), ['A', 'B', 'C']);
    assert.equal(next.some((node) => node.title === 'inside'), false);
    assert.throws(() => removeNode(next, other));
  });
});

describe('search and lookup', () => {
  it('matches all tokens in title or url', () => {
    const nodes = addNode(seed(), SPACE, { parentId: other, kind: 'bookmark', title: 'Rust docs', url: 'https://doc.rust-lang.org/std/' }).nodes;
    assert.deepEqual(searchNodes(nodes, 'rust std', 5).map((node) => node.title), ['Rust docs']);
    assert.deepEqual(searchNodes(nodes, '   ', 5), []);
  });
  it('finds a page ignoring hash and trailing slash', () => {
    assert.equal(findByUrl(seed(), 'https://a.test#top').length, 1);
  });
  it('cleanUrl allows web, vela and file only', () => {
    assert.equal(cleanUrl('vela://history/'), 'vela://history/');
    assert.equal(cleanUrl('data:text/html,hi'), null);
  });
});

describe('importNodes', () => {
  it('adds a folder under Other bookmarks and counts only bookmarks', () => {
    const result = importNodes(seed(), SPACE, 'Imported from Chrome', [
      { title: 'Top', url: 'https://top.test/' },
      { title: 'Folder', children: [{ title: 'Deep', url: 'https://deep.test/' }, { title: 'bad', url: 'chrome://settings' }] },
      { title: 'Empty', children: [] },
    ]);
    assert.equal(result.added, 2);
    const nodes = normalizeTree(SPACE, result.nodes.filter((node) => node.parentId !== null));
    const imported = childrenOf(nodes, other)[0]!;
    assert.equal(imported.title, 'Imported from Chrome');
    assert.deepEqual(titles(nodes, imported.id), ['Top', 'Folder', 'Empty']);
    const folder = childrenOf(nodes, imported.id)[1]!;
    assert.deepEqual(titles(nodes, folder.id), ['Deep']);
  });
});
