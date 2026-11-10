import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readBackup, termKey, validateCatalog } from './core.js';
import { sentenceKey, sentenceMatches, validateSentences, wordPanelCatalog } from './sentence-core.js';

const words = JSON.parse(await readFile(new URL('./words.json', import.meta.url), 'utf8'));
const sentences = JSON.parse(await readFile(new URL('./sentences.json', import.meta.url), 'utf8'));
const dictionary = validateCatalog(words);
const list = validateSentences(sentences);
const wordPanel = wordPanelCatalog(dictionary, list);
const target = 'Calculate the horizontal and vertical block indices.';

test('sentence panel has unique, intact sentences with word-by-word translation', () => {
  assert.ok(list.every(row => row.cn && row.words.every(word => word.cn)));
  assert.equal(sentenceKey('  HELLO   WORLD '), 'hello world');
  assert.throws(() => validateSentences([...list, { ...list[0], english: 'A different sentence.' }]), /ID 重复/);
  assert.throws(() => validateSentences([
    ...list, { ...list[0], id: 's-00000000000000', english: list[0].english.toUpperCase() },
  ]), /英文句子重复/);
});

test('each written English token in every sentence has its own word panel entry', () => {
  for (const sentence of list) {
    const tokens = sentence.english.match(/[A-Za-z][A-Za-z0-9]*(?:[-'’][A-Za-z0-9]+|\.[0-9]+)*/g) ?? [];
    assert.deepEqual(sentence.words.map(word => word.en), tokens, sentence.english);
    for (const word of sentence.words) {
      assert.ok(wordPanel.has(termKey(word.en)), 'Missing dictionary word ' + word.en + ' in ' + sentence.english);
    }
  }
});

test('real A03 and A04 comments are searchable by English, Chinese and code', () => {
  for (const query of [target.toUpperCase(),
    'Convert the remainder into a black or white pixel value.',
    'Increase the spatial frequency by reducing the stripe size.', '余数', 'horizontal', 'const int blockX']) {
    assert.ok(list.some(row => sentenceMatches(row, query)), 'Missing sentence: ' + query);
  }
});

test('a sentence moved out of the public word panel still resolves in a legacy personal backup', () => {
  const key = termKey(target);
  const original = dictionary.get(key);
  assert.ok(original);
  assert.equal(wordPanel.has(key), false);
  assert.equal(wordPanelCatalog(dictionary, []).get(key), original);
  const restored = readBackup(JSON.stringify([
    { ...original, favorite: true, note: '原有句子笔记' },
  ]), dictionary);
  assert.deepEqual(restored.rows, [{
    term_key: key, word: null, favorite: true, note: '原有句子笔记',
  }]);
});
