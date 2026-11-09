import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeBackup, mergeRecord, readBackup, searchMatches, termKey, validateCatalog } from './core.js';

const raw = JSON.parse(await readFile(new URL('./words.json', import.meta.url), 'utf8'));
const catalog = validateCatalog(raw);
const base = catalog.get('weighted grayscale');
const sample = 'Compute grayscale using BT.709 luma weights.';
const key = 'weighted grayscale';

test('English phrases and Chinese are searchable, with original display casing', () => {
  for (const query of ['weighted grayscale', '加权灰度', 'not declared in this scope', 'unused variable', 'same result using']) {
    assert.ok(raw.some(entry => searchMatches(entry, query)));
  }
  assert.equal(termKey('  WEIGHTED   Grayscale '), key);
  assert.ok(raw.some(word => /[A-Z]/.test(word.term)));
});

test('public updates reject missing fields and normalized duplicate terms', () => {
  assert.throws(() => validateCatalog([...raw, { ...base, term: 'WEIGHTED   GRAYSCALE' }]), /重复/);
  assert.throws(() => validateCatalog([{ ...base, example: '' }]), /example/);
});

test('legacy JSON and inert HTML preserve edits, favorites and personal additions', () => {
  const changed = [
    { ...base, favorite: true },
    { ...base, term: 'QA personal', example: sample, custom: true },
  ];
  const html = '<!doctype html><script id="seed-data" type="application/json">'
    + JSON.stringify(changed) + '</script><script>throw new Error("never executed")</script>';
  for (const input of [JSON.stringify(changed), html]) {
    const { rows } = readBackup(input, catalog);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].favorite, true);
    assert.equal(rows[0].word, null);
    assert.equal(rows[1].word.example, sample);
    assert.deepEqual(readBackup(JSON.stringify(makeBackup(rows)), catalog).rows, rows);
  }
});

test('updated public text preserves notes and imports retain current versions', () => {
  const privateRow = { term_key: key, word: null, favorite: true, note: '自用笔记' };
  const updatedBase = { ...base, meaning: '新公共说明' };
  const updated = new Map([[key, updatedBase]]);
  assert.deepEqual(readBackup(JSON.stringify(makeBackup([privateRow])), updated).rows, [privateRow]);
  const result = mergeRecord(privateRow, { ...privateRow, favorite: false, note: '旧备份中的笔记' });
  assert.equal(result.conflict, true);
  assert.deepEqual(result.row, privateRow);
});
