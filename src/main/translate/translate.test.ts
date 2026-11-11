import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, route, totalSize } from './catalog';
import { detectLanguage } from './detect';
import { segmentText } from './segment';
import { normalizeLang } from '../../shared/translate';

const file = (fromLang: string, toLang: string, fileType: string, version: string, extra: Record<string, unknown> = {}) => ({
  fromLang,
  toLang,
  fileType,
  version,
  name: `${fileType}.${fromLang}${toLang}.bin`,
  filter_expression: '',
  attachment: { location: `main-workspace/translations-models/${fromLang}${toLang}${fileType}${version}.bin`, hash: 'a'.repeat(64), size: 10 },
  ...extra,
});

const full = (from: string, to: string, version: string) => [file(from, to, 'model', version), file(from, to, 'lex', version), file(from, to, 'vocab', version)];

test('parseCatalog picks the newest complete stable version per pair', () => {
  const sets = parseCatalog({
    data: [
      ...full('en', 'de', '1.0'),
      ...full('en', 'de', '2.1'),
      ...full('en', 'de', '3.0a1'),
      file('en', 'de', 'model', '2.2'),
      ...full('de', 'en', '2.0'),
      ...full('en', 'ru', '2.0').map((record) => ({ ...record, filter_expression: "env.channel == 'nightly'" })),
    ],
  });
  assert.deepEqual(
    sets.map((set) => `${set.from}-${set.to}@${set.version}`),
    ['de-en@2.0', 'en-de@2.1'],
  );
  assert.equal(totalSize(sets[1]), 30);
});

test('parseCatalog accepts split vocabularies and rejects bad hashes / paths', () => {
  const sets = parseCatalog({
    data: [
      file('ja', 'en', 'model', '1.0'),
      file('ja', 'en', 'lex', '1.0'),
      file('ja', 'en', 'srcvocab', '1.0'),
      file('ja', 'en', 'trgvocab', '1.0'),
      ...full('fr', 'en', '1.0').map((record) => ({ ...record, attachment: { ...record.attachment, hash: 'nope' } })),
      ...full('it', 'en', '1.0').map((record) => ({ ...record, attachment: { ...record.attachment, location: '../../etc/passwd' } })),
    ],
  });
  assert.deepEqual(sets.map((set) => `${set.from}-${set.to}`), ['ja-en']);
  assert.throws(() => parseCatalog({}));
});

test('route goes direct or pivots through English', () => {
  const sets = parseCatalog({ data: [...full('de', 'en', '1.0'), ...full('en', 'fr', '1.0'), ...full('en', 'de', '1.0')] });
  assert.deepEqual(route(sets, 'de', 'en').map((set) => `${set.from}-${set.to}`), ['de-en']);
  assert.deepEqual(route(sets, 'de', 'fr').map((set) => `${set.from}-${set.to}`), ['de-en', 'en-fr']);
  assert.deepEqual(route(sets, 'fr', 'de'), []);
  assert.deepEqual(route(sets, 'de', 'de'), []);
});

test('detectLanguage recognises common languages', () => {
  assert.equal(detectLanguage('The quick brown fox jumps over the lazy dog and this is the text of a page that is in English.'), 'en');
  assert.equal(detectLanguage('Der schnelle braune Fuchs springt über den faulen Hund, und das ist nicht ein Text auf Englisch.'), 'de');
  assert.equal(detectLanguage('Le renard brun rapide saute par-dessus le chien paresseux et il est dans une maison pour les vacances.'), 'fr');
  assert.equal(detectLanguage('Быстрая коричневая лиса прыгает через ленивую собаку и это текст на русском языке.'), 'ru');
  assert.equal(detectLanguage('これは日本語のテキストです。ひらがなとカタカナが含まれています。'), 'ja');
  assert.equal(detectLanguage('short'), null);
});

test('normalizeLang maps tags to catalog codes', () => {
  assert.equal(normalizeLang('de-DE'), 'de');
  assert.equal(normalizeLang('en_US'), 'en');
  assert.equal(normalizeLang('zh-TW'), 'zh-Hant');
  assert.equal(normalizeLang('zh'), 'zh-Hans');
  assert.equal(normalizeLang('no'), 'nb');
  assert.equal(normalizeLang(''), null);
  assert.equal(normalizeLang('x-klingon'), null);
});

test('segmentText keeps surrounding whitespace out of the translated core', () => {
  assert.deepEqual(segmentText('  Hello world \n'), { lead: '  ', core: 'Hello world', trail: ' \n' });
  assert.equal(segmentText('   '), null);
  assert.equal(segmentText(' 12:30 '), null);
  assert.equal(segmentText('— · —'), null);
});
