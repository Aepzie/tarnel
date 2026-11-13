import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeDataUrl, redirectResponse, redirectUrlFor, resourceNameOf, rewriteRedirects, type RedirectResource } from './adblock-redirects';

const GPT_STUB = '(function(){window.googletag={cmd:{push:function(f){f()}}}})();';
const resources = {
  getResource(name: string): RedirectResource {
    if (name === 'googletagservices_gpt.js')
      return { filename: name, dataUrl: `data:application/javascript;base64,${Buffer.from(GPT_STUB).toString('base64')}` };
    if (name === 'noop.txt') return { filename: name, dataUrl: 'data:text/plain;base64,' };
    return { dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' };
  },
};

test('named resources map to the custom scheme and back', () => {
  const url = redirectUrlFor({ filename: 'googletagservices_gpt.js', dataUrl: 'data:,' });
  assert.equal(url, 'tarnel-res://r/googletagservices_gpt.js');
  assert.equal(resourceNameOf(url), 'googletagservices_gpt.js');
  assert.equal(resourceNameOf('tarnel-res://r/noop.js?x=1'), 'noop.js');
  assert.equal(resourceNameOf('tarnel-res://r/'), null);
  assert.equal(resourceNameOf('https://r/noop.js'), null);
  assert.equal(resourceNameOf('tarnel-res://r/%E0%A4%A'), null);
});

test('unnamed fallback resources keep their data: URL', () => {
  assert.equal(redirectUrlFor({ dataUrl: 'data:text/plain,' }), 'data:text/plain,');
});

test('data URLs decode in base64 and plain form', () => {
  const b64 = decodeDataUrl(`data:application/javascript;base64,${Buffer.from('a=1').toString('base64')}`);
  assert.equal(b64?.mimeType, 'application/javascript');
  assert.equal(Buffer.from(b64!.body).toString(), 'a=1');
  const plain = decodeDataUrl('data:text/css;charset=utf-8,a%20b');
  assert.equal(plain?.mimeType, 'text/css;charset=utf-8');
  assert.equal(Buffer.from(plain!.body).toString(), 'a b');
  assert.equal(decodeDataUrl('https://x/'), null);
});

test('rewriteRedirects swaps only the redirect target', () => {
  const engine = {
    match: (url: string) =>
      url === 'gpt' ? { match: true, redirect: resources.getResource('googletagservices_gpt.js') } : { match: url === 'ad', redirect: undefined },
  };
  rewriteRedirects(engine);
  assert.equal(engine.match('gpt').redirect?.dataUrl, 'tarnel-res://r/googletagservices_gpt.js');
  assert.deepEqual(engine.match('ad'), { match: true, redirect: undefined });
});

test('redirectResponse serves the stub with its MIME type', async () => {
  const response = redirectResponse('tarnel-res://r/googletagservices_gpt.js', resources);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/javascript');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(await response.text(), GPT_STUB);
  assert.equal((await redirectResponse('tarnel-res://r/noop.txt', resources).text()), '');
  assert.equal(redirectResponse('tarnel-res://r/x.js', null).status, 404);
  assert.equal(redirectResponse('tarnel-res://other/x.js', resources).status, 404);
});
