import { termKey } from './core.js';

const max = { english: 600, cn: 1500, lesson: 100, kind: 32, code: 5000, note: 1200 };

export function sentenceKey(sentence) {
  return sentence.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

export function validateSentences(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('句子库必须为非空数组。');
  const seen = new Set();
  const ids = new Set();
  for (const [index, row] of raw.entries()) {
    const err = text => { throw new Error('句子 ' + (index + 1) + '：' + text); };
    if (!row || typeof row !== 'object' || Array.isArray(row)) err('结构错误');
    if (typeof row.id !== 'string' || !/^s-[a-f0-9]{14}$/.test(row.id)) err('句子 ID 错误');
    if (ids.has(row.id)) err('句子 ID 重复');
    ids.add(row.id);
    for (const [key, size] of Object.entries(max)) {
      if (typeof row[key] !== 'string' || row[key].length > size || row[key].includes('\0')) err(key + ' 字段错误');
      if (['english', 'cn', 'lesson', 'kind'].includes(key) && !row[key].trim()) err(key + ' 为空');
    }
    if (!['代码注释', '学习例句', '编译报错'].includes(row.kind)) err('未知类型');
    const key = sentenceKey(row.english);
    if (seen.has(key)) err('英文句子重复：' + row.english);
    seen.add(key);
    if (!Array.isArray(row.words) || !row.words.length || row.words.length > 100) err('逐词解释缺失或过长');
    for (const word of row.words) {
      if (!word || typeof word.en !== 'string' || !word.en.trim() || word.en.length > 80
        || typeof word.cn !== 'string' || !word.cn.trim() || word.cn.length > 300
        || word.en.includes('\0') || word.cn.includes('\0')) err('逐词解释无效');
    }
  }
  return raw;
}

export function sentenceMatches(row, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.english, row.cn, row.lesson, row.kind, row.code, row.note,
    ...row.words.flatMap(item => [item.en, item.cn])]
    .some(value => value.toLowerCase().includes(q));
}

export function wordPanelCatalog(catalog, sentences) {
  const sentenceTerms = new Set(sentences.map(row => termKey(row.english)));
  return new Map([...catalog].filter(([key]) => !sentenceTerms.has(key)));
}
