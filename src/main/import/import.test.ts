import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countBookmarks, msToWebkitMs, parseChromiumBookmarks, webkitToMs, WEBKIT_EPOCH_OFFSET_MS } from './chromium-parse';
import { parseCsv, parsePasswordCsv } from './csv';
import { assembleFirefoxBookmarks, parseProfilesIni, type FirefoxBookmarkRow } from './firefox-parse';

describe('WebKit epoch', () => {
  it('converts µs since 1601 (string or number) to Unix ms', () => {
    assert.equal(webkitToMs(String(WEBKIT_EPOCH_OFFSET_MS * 1000)), undefined);
    assert.equal(webkitToMs('13350000000000000'), 13_350_000_000_000 - WEBKIT_EPOCH_OFFSET_MS);
    assert.equal(webkitToMs(13_350_000_000_000_000), webkitToMs('13350000000000000'));
    assert.equal(new Date(webkitToMs('13350000000000000')!).getUTCFullYear(), 2024);
  });
  it('treats 0, garbage and pre-1970 values as unset', () => {
    assert.equal(webkitToMs('0'), undefined);
    assert.equal(webkitToMs(0), undefined);
    assert.equal(webkitToMs('abc'), undefined);
    assert.equal(webkitToMs(undefined), undefined);
    assert.equal(webkitToMs('1000'), undefined);
  });
  it('round-trips through msToWebkitMs', () => {
    const now = Date.UTC(2026, 10, 10);
    assert.equal(webkitToMs(msToWebkitMs(now) * 1000), now);
  });
});

describe('parseChromiumBookmarks', () => {
  const file = JSON.stringify({
    checksum: 'x',
    version: 1,
    roots: {
      bookmark_bar: {
        type: 'folder',
        name: 'Lesezeichenleiste',
        date_added: '13350000000000000',
        children: [
          { type: 'url', name: 'Example', url: 'https://example.com/', date_added: '13350000000000000' },
          { type: 'url', name: 'Bookmarklet', url: 'javascript:alert(1)' },
          { type: 'folder', name: 'Work', children: [{ type: 'url', name: 'Docs', url: 'https://docs.example.com/' }] },
          { type: 'folder', name: 'Empty', children: [] },
        ],
      },
      other: { type: 'folder', name: 'Other', children: [{ type: 'url', name: 'Wiki', url: 'http://wiki.example.org/' }] },
      synced: { type: 'folder', name: 'Mobile', children: [] },
    },
  });

  it('keeps roots in order with normalised titles and drops empty roots', () => {
    const tree = parseChromiumBookmarks(file);
    assert.deepEqual(
      tree.map((node) => node.title),
      ['Bookmarks bar', 'Other bookmarks'],
    );
    assert.equal(countBookmarks(tree), 3);
  });
  it('keeps nested folders, empty folders, dates and drops non-web urls', () => {
    const [bar] = parseChromiumBookmarks(file);
    assert.deepEqual(
      bar!.children!.map((node) => node.title),
      ['Example', 'Work', 'Empty'],
    );
    assert.equal(bar!.children![0]!.addedAt, webkitToMs('13350000000000000'));
    assert.equal(bar!.children![1]!.children![0]!.url, 'https://docs.example.com/');
    assert.deepEqual(bar!.children![2]!.children, []);
  });
  it('accepts a BOM and rejects non-bookmark JSON', () => {
    assert.equal(parseChromiumBookmarks(`\uFEFF${file}`).length, 2);
    assert.throws(() => parseChromiumBookmarks('{"foo":1}'));
    assert.throws(() => parseChromiumBookmarks('not json'));
  });
});

describe('assembleFirefoxBookmarks', () => {
  const row = (r: Partial<FirefoxBookmarkRow> & Pick<FirefoxBookmarkRow, 'id' | 'parent' | 'type'>): FirefoxBookmarkRow => ({
    position: 0,
    title: null,
    dateAdded: null,
    guid: null,
    url: null,
    ...r,
  });
  const rows: FirefoxBookmarkRow[] = [
    row({ id: 1, parent: null, type: 2, guid: 'root________' }),
    row({ id: 2, parent: 1, type: 2, guid: 'menu________', title: 'menu' }),
    row({ id: 3, parent: 1, type: 2, guid: 'toolbar_____', title: 'toolbar' }),
    row({ id: 4, parent: 1, type: 2, guid: 'tags________', title: 'tags' }),
    row({ id: 5, parent: 1, type: 2, guid: 'unfiled_____', title: 'unfiled' }),
    row({ id: 10, parent: 3, type: 1, position: 2, title: 'Third', url: 'https://c.example/' }),
    row({ id: 11, parent: 3, type: 1, position: 0, title: 'First', url: 'https://a.example/', dateAdded: 1_700_000_000_000_000 }),
    row({ id: 12, parent: 3, type: 2, position: 1, title: 'Folder' }),
    row({ id: 13, parent: 12, type: 1, position: 0, title: 'Nested', url: 'https://b.example/' }),
    row({ id: 14, parent: 3, type: 3, position: 3 }),
    row({ id: 15, parent: 2, type: 1, position: 0, title: 'Recent', url: 'place:sort=8' }),
    row({ id: 16, parent: 4, type: 2, position: 0, title: 'a-tag' }),
    row({ id: 17, parent: 16, type: 1, position: 0, url: 'https://a.example/' }),
  ];

  it('orders by position, nests folders and skips separators, place: queries, tags and empty roots', () => {
    const tree = assembleFirefoxBookmarks(rows);
    assert.deepEqual(
      tree.map((node) => node.title),
      ['Bookmarks toolbar'],
    );
    const toolbar = tree[0]!;
    assert.deepEqual(
      toolbar.children!.map((node) => node.title),
      ['First', 'Folder', 'Third'],
    );
    assert.equal(toolbar.children![0]!.addedAt, 1_700_000_000_000);
    assert.equal(toolbar.children![1]!.children![0]!.url, 'https://b.example/');
    assert.equal(countBookmarks(tree), 3);
  });
  it('survives orphans and cycles', () => {
    const cyclic = [row({ id: 3, parent: 3, type: 2, guid: 'toolbar_____' }), row({ id: 9, parent: 99, type: 1, url: 'https://x.example/' })];
    assert.deepEqual(assembleFirefoxBookmarks(cyclic), []);
  });
});

describe('parseProfilesIni', () => {
  it('reads profiles and marks the install default', () => {
    const ini = [
      '[Install308046B0AF4A39CB]',
      'Default=Profiles/abcd.default-release',
      '',
      '[Profile1]',
      'Name=default',
      'IsRelative=1',
      'Path=Profiles/wxyz.default',
      'Default=1',
      '',
      '[Profile0]',
      'Name=default-release',
      'IsRelative=1',
      'Path=Profiles/abcd.default-release',
      '',
      '[Profile2]',
      'Name=Elsewhere',
      'IsRelative=0',
      'Path=D:\\ff\\custom',
      '',
      '[General]',
      'StartWithLastProfile=1',
    ].join('\r\n');
    const profiles = parseProfilesIni(ini);
    assert.equal(profiles.length, 3);
    assert.deepEqual(profiles.find((p) => p.name === 'default-release'), {
      name: 'default-release',
      path: 'Profiles/abcd.default-release',
      relative: true,
      isDefault: true,
    });
    assert.equal(profiles.find((p) => p.name === 'Elsewhere')!.relative, false);
  });
});

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and newlines inside fields, CRLF and BOM', () => {
    const text = '\uFEFFa,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\nplain,,last\n';
    assert.deepEqual(parseCsv(text), [
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['plain', '', 'last'],
    ]);
  });
  it('handles a missing trailing newline, blank lines and a trailing empty field', () => {
    assert.deepEqual(parseCsv('a,b\n\n1,\n2,3'), [
      ['a', 'b'],
      ['1', ''],
      ['2', '3'],
    ]);
  });
  it('keeps CR-only line breaks and quoted empty fields', () => {
    assert.deepEqual(parseCsv('a,b\r"",x\r'), [
      ['a', 'b'],
      ['', 'x'],
    ]);
  });
});

describe('parsePasswordCsv', () => {
  it('reads Chrome / Edge / Brave exports', () => {
    const csv = 'name,url,username,password,note\r\nexample.com,https://example.com/login,alice,"p,a""ss",\r\nandroid,android://abc@com.app/,bob,x,\r\n';
    const parsed = parsePasswordCsv(csv);
    assert.equal(parsed.format, 'Chrome / Edge / Brave');
    assert.deepEqual(parsed.logins, [{ url: 'https://example.com/login', username: 'alice', password: 'p,a"ss' }]);
    assert.equal(parsed.skipped, 1);
  });
  it('reads Firefox exports', () => {
    const csv =
      '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n' +
      '"https://mail.example.org","carol","secret",,"https://mail.example.org","{1}","1","2","3"\n';
    const parsed = parsePasswordCsv(csv);
    assert.equal(parsed.format, 'Firefox');
    assert.deepEqual(parsed.logins, [{ url: 'https://mail.example.org/', username: 'carol', password: 'secret' }]);
  });
  it('reads Bitwarden exports and skips non-login items', () => {
    const csv =
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n' +
      ',,login,Site,,,0,"https://a.example/\nhttps://b.example/",dave,pw1,\n' +
      ',,note,Secure note,hello,,0,,,,\n';
    const parsed = parsePasswordCsv(csv);
    assert.equal(parsed.format, 'Bitwarden');
    assert.deepEqual(parsed.logins, [{ url: 'https://a.example/', username: 'dave', password: 'pw1' }]);
    assert.equal(parsed.skipped, 1);
  });
  it('reads 1Password exports and adds a scheme to bare hosts', () => {
    const csv = 'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nBank,bank.example,eve,pw2,,false,false,,\nNo password,https://x.example,eve,,,,,,\n';
    const parsed = parsePasswordCsv(csv);
    assert.equal(parsed.format, '1Password');
    assert.deepEqual(parsed.logins, [{ url: 'https://bank.example/', username: 'eve', password: 'pw2' }]);
    assert.equal(parsed.skipped, 1);
  });
  it('rejects files without url and password columns', () => {
    assert.throws(() => parsePasswordCsv('a,b\n1,2\n'));
    assert.throws(() => parsePasswordCsv(''));
  });
});
