const limits = { term: 200, cn: 1000, meaning: 6000, example: 6000, category: 100 };
const backupFormat = 'cgcpp-dictionary-personal-v1';

export function termKey(term) {
  return term.replace(/[ \t\r\n\f\v]+/g, ' ').replace(/^ | $/g, '')
    .replace(/[A-Z]/g, letter => letter.toLowerCase());
}

export function wordFrom(input, publicWord = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('词条应包含英文、中文、学习说明、例句与分类。');
  }
  const word = {};
  for (const [field, limit] of Object.entries(limits)) {
    const value = input[field] ?? (publicWord ? undefined : '');
    if (typeof value !== 'string' || value.length > limit || value.includes('\0')) {
      throw new Error('字段 ' + field + ' 格式不正确或过长。');
    }
    if (publicWord && !value.trim()) throw new Error('缺少字段 ' + field + '。');
    word[field] = value;
  }
  if (!word.term.trim() || !word.cn.trim()) throw new Error('请填写英文词条与中文释义。');
  if (!word.category.trim()) word.category = '个人笔记';
  return word;
}

export function validateCatalog(input) {
  if (!Array.isArray(input) || !input.length) throw new Error('公共词库应为非空数组。');
  const catalog = new Map();
  for (const [index, row] of input.entries()) {
    let word;
    try {
      word = wordFrom(row, true);
      if (Object.keys(row).length !== Object.keys(limits).length) throw new Error('发现未知字段。');
    } catch (error) {
      throw new Error('第 ' + (index + 1) + ' 条：' + error.message);
    }
    const key = termKey(word.term);
    if (catalog.has(key)) throw new Error('公共词库存在重复英文词条：' + word.term);
    catalog.set(key, word);
  }
  return catalog;
}

export function sameWord(left, right) {
  if (!left || !right) return left === right;
  return Object.keys(limits).every(field => left[field] === right[field]);
}

export function sameContent(left, right) {
  return Boolean(left && right && left.term_key === right.term_key
    && left.note === right.note && left.favorite === right.favorite
    && sameWord(left.word, right.word));
}

export function personalRecord(key, input) {
  if (!input || typeof key !== 'string' || !key.trim() || key.length > limits.term
    || key.includes('\0') || termKey(key) !== key) throw new Error('个人记录索引无效。');
  const word = input.word == null ? null : wordFrom(input.word);
  if (word && termKey(word.term) !== key) throw new Error('词条与个人记录索引不一致。');
  const note = input.note ?? '';
  const favorite = input.favorite ?? false;
  if (typeof note !== 'string' || note.length > 12000 || note.includes('\0')
    || typeof favorite !== 'boolean') throw new Error('私人笔记或收藏格式不正确。');
  return { term_key: key, word, favorite, note };
}

export function hasContent(row) {
  return Boolean(row.word || row.favorite || row.note);
}

export function makeBackup(rows) {
  return {
    format: backupFormat,
    exported_at: new Date().toISOString(),
    records: Array.from(rows, row => personalRecord(row.term_key, row)),
  };
}

export function readBackup(text, catalog) {
  let source = text.replace(/^\uFEFF/, '').trim();
  if (source.startsWith('<')) {
    // Extract inert JSON from the known legacy export without parsing or running its HTML.
    const matches = [...source.matchAll(/<script\b[^>]*\bid=["']seed-data["'][^>]*>([\s\S]*?)<\/script\s*>/gi)];
    if (matches.length !== 1) throw new Error('找不到旧词典内嵌的词条数据。');
    source = matches[0][1];
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('无法解析备份中的 JSON。');
  }
  const legacy = Array.isArray(parsed);
  if (!legacy && (parsed?.format !== backupFormat || !Array.isArray(parsed.records))) {
    throw new Error('备份文件格式无法识别。');
  }
  const rows = new Map();
  let unchanged = 0;
  let duplicates = 0;
  for (const [index, input] of (legacy ? parsed : parsed.records).entries()) {
    try {
      let row;
      if (legacy) {
        const word = wordFrom(input);
        const key = termKey(word.term);
        row = personalRecord(key, {
          word: sameWord(word, catalog.get(key)) ? null : word,
          favorite: Boolean(input.favorite),
          note: input.note ?? '',
        });
      } else {
        row = personalRecord(input?.term_key, input);
      }
      if (!hasContent(row)) {
        unchanged++;
        continue;
      }
      if (rows.has(row.term_key)) {
        const prior = rows.get(row.term_key);
        const result = mergeRecord(prior, row);
        if (result.conflict) throw new Error('备份内有不同版本的同名词条，请保留文件并核对。');
        rows.set(row.term_key, result.row);
        duplicates++;
        continue;
      }
      rows.set(row.term_key, row);
    } catch (error) {
      throw new Error('备份第 ' + (index + 1) + ' 条：' + error.message);
    }
  }
  return { rows: [...rows.values()], unchanged, duplicates };
}

export function mergeRecord(current, incoming) {
  if (!current) return { row: incoming, conflict: false };
  const wordConflict = current.word && incoming.word && !sameWord(current.word, incoming.word);
  const noteConflict = current.note && incoming.note && current.note !== incoming.note;
  return {
    row: {
      term_key: current.term_key,
      word: current.word ?? incoming.word,
      note: current.note || incoming.note,
      favorite: current.favorite || incoming.favorite,
    },
    conflict: Boolean(wordConflict || noteConflict),
  };
}

export function searchMatches(entry, query) {
  return [entry.term, entry.cn, entry.meaning, entry.example, entry.category, entry.record?.note,
    ...Object.values(entry.base ?? {})].some(value => value?.toLowerCase().includes(query));
}
