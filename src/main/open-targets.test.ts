import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileUrlForPath, openTargetsFromArgs, type OpenTargetEnv, type PathKind } from './open-targets';

function env(windows: boolean, cwd: string, entries: Record<string, PathKind>): OpenTargetEnv {
  const norm = (p: string): string => (windows ? p.toLowerCase() : p);
  const table = new Map(Object.entries(entries).map(([k, v]) => [norm(k), v]));
  return { cwd, windows, stat: (path) => table.get(norm(path)) ?? null };
}

describe('openTargetsFromArgs (Windows)', () => {
  const win = env(true, 'C:\\Users\\me\\Documents', {
    'C:\\Users\\me\\Documents\\report.pdf': 'file',
    'C:\\Users\\me\\Documents\\my notes.txt': 'file',
    'D:\\Media\\clip one.mp4': 'file',
    'C:\\Users\\me\\Documents\\photos': 'directory',
    'C:\\Users\\me\\Documents\\a#b%c.html': 'file',
  });

  it('absolute paths with spaces become file URLs', () => {
    assert.deepEqual(openTargetsFromArgs(['D:\\Media\\clip one.mp4'], win), ['file:///D:/Media/clip%20one.mp4']);
  });
  it('relative paths resolve against the working directory', () => {
    assert.deepEqual(openTargetsFromArgs(['report.pdf', '.\\my notes.txt'], win), [
      'file:///C:/Users/me/Documents/report.pdf',
      'file:///C:/Users/me/Documents/my%20notes.txt',
    ]);
  });
  it('special characters are percent-encoded', () => {
    assert.deepEqual(openTargetsFromArgs(['a#b%c.html'], win), ['file:///C:/Users/me/Documents/a%23b%25c.html']);
  });
  it('file:// URLs are accepted when the file exists', () => {
    assert.deepEqual(openTargetsFromArgs(['file:///C:/Users/me/Documents/report.pdf', 'file:///C:/missing.pdf'], win), [
      'file:///C:/Users/me/Documents/report.pdf',
    ]);
  });
  it('flags, Chromium switches, directories and missing paths are ignored', () => {
    assert.deepEqual(
      openTargetsFromArgs(['--allow-file-access-from-files', '--original-process-start-time=1337', '-x', '.', 'photos', 'nope.pdf', ''], win),
      [],
    );
  });
  it('web and vela URLs pass through unchanged', () => {
    assert.deepEqual(openTargetsFromArgs(['https://example.com/a b', 'vela://settings', 'report.pdf'], win), [
      'https://example.com/a b',
      'vela://settings',
      'file:///C:/Users/me/Documents/report.pdf',
    ]);
  });
  it('a drive path is not mistaken for a URL scheme', () => {
    assert.equal(fileUrlForPath('c:\\users\\me\\documents\\report.pdf', win), 'file:///c:/users/me/documents/report.pdf');
  });
});

describe('openTargetsFromArgs (POSIX)', () => {
  const nix = env(false, '/home/me', {
    '/home/me/docs/paper.pdf': 'file',
    '/tmp/with space.svg': 'file',
    '/home/me/docs': 'directory',
  });

  it('absolute and relative paths', () => {
    assert.deepEqual(openTargetsFromArgs(['/tmp/with space.svg', 'docs/paper.pdf', './docs/../docs/paper.pdf'], nix), [
      'file:///tmp/with%20space.svg',
      'file:///home/me/docs/paper.pdf',
      'file:///home/me/docs/paper.pdf',
    ]);
  });
  it('file URLs, flags, directories and missing files', () => {
    assert.deepEqual(openTargetsFromArgs(['file:///home/me/docs/paper.pdf', '--inspect=0', 'docs', '/nope.png', 'file://remote/share.pdf'], nix), [
      'file:///home/me/docs/paper.pdf',
    ]);
  });
  it('rejects NUL bytes', () => {
    assert.equal(fileUrlForPath('/home/me/docs/paper.pdf\0', nix), null);
  });
});
