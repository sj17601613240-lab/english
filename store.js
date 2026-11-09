import { hasContent, personalRecord, sameContent } from './core.js';

export const guestKey = 'cgcpp-dictionary-guest-v1';
const columns = 'term_key,word,note,favorite,revision';
const conflictMessage = '词条已由其他设备或标签页更改。请同步后核对，当前表单仍可复制。';

export function guestStore() {
  function read() {
    const stored = JSON.parse(localStorage.getItem(guestKey) ?? '[]');
    if (!Array.isArray(stored)) throw new Error('本机数据格式有误，请保留原备份。');
    return new Map(stored.map(row => [row.term_key, {
      ...personalRecord(row.term_key, row), revision: row.revision,
    }]));
  }

  function saveLocally(row, before) {
    const rows = read();
    const key = before?.term_key ?? row.term_key;
    if (rows.get(key)?.revision !== before?.revision) throw new Error(conflictMessage);
    if (key !== row.term_key && rows.has(row.term_key)) throw new Error('这个英文词条已存在。');
    if (sameContent(before, row)) return before;
    rows.delete(key);
    const written = hasContent(row) ? { ...row, revision: crypto.randomUUID() } : null;
    if (written) rows.set(row.term_key, written);
    try {
      localStorage.setItem(guestKey, JSON.stringify([...rows.values()]));
    } catch {
      throw new Error('本机保存失败。请检查浏览器存储权限与剩余空间。');
    }
    return written;
  }

  async function save(row, before) {
    if (!navigator.locks) throw new Error('当前浏览器无法安全保存访客数据。请使用新版浏览器或登录账号。');
    return navigator.locks.request(guestKey, () => saveLocally(row, before));
  }

  return { read, save };
}

export function cloudStore(client, userId) {
  const table = () => client.from('cgcpp_entries');

  async function read() {
    const rows = new Map();
    let cursor;
    while (true) {
      let query = table().select(columns).eq('user_id', userId).order('term_key').limit(200);
      if (cursor !== undefined) query = query.gt('term_key', cursor);
      const { data, error } = await query.abortSignal(AbortSignal.timeout(15000));
      if (error) throw new Error('云端读取失败。请检查网络后点击「同步」。');
      for (const row of data) rows.set(row.term_key, row);
      if (data.length < 200) return rows;
      cursor = data.at(-1).term_key;
    }
  }

  async function save(row, before) {
    if (sameContent(before, row)) return before;
    const keep = hasContent(row);
    if (!before && !keep) return null;
    const payload = { ...row, revision: crypto.randomUUID() };
    let query;
    if (before) {
      query = (keep ? table().update(payload) : table().delete())
        .eq('user_id', userId).eq('term_key', before.term_key).eq('revision', before.revision);
    } else {
      query = table().insert({ user_id: userId, ...payload });
    }
    const { data, error } = await query.select(columns).maybeSingle().abortSignal(AbortSignal.timeout(15000));
    if (error?.code === '23505') throw new Error('同名词条已在云端存在。请同步后核对。');
    if (error) throw new Error('云端未确认保存。请检查网络并同步，核对结果后再重试。');
    if (!data) throw new Error(conflictMessage);
    return keep ? data : null;
  }

  return { read, save };
}
