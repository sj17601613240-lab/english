import { publishableKey, siteUrl, supabaseUrl } from './config.js';
import {
  makeBackup, mergeRecord, personalRecord, readBackup, sameContent,
  searchMatches, termKey, validateCatalog, wordFrom,
} from './core.js';
import { cloudStore, guestKey, guestStore } from './store.js';
import { wordPanelCatalog } from './sentence-core.js';
import { sentenceCatalog } from './sentences.js';

const el = id => document.getElementById(id);
const editor = el('editor');
const wordForm = el('word-form');
const confirmation = el('confirm-dialog');
const authDialog = el('auth-dialog');
const authForm = el('auth-form');
const guest = guestStore();
const pageSize = 30;
const alphabet = ['', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
const fields = ['term', 'cn', 'meaning', 'example', 'category'];
const sortEnglish = new Intl.Collator('en', { sensitivity: 'base' });
const sortChinese = new Intl.Collator('zh-CN');
const client = window.supabase?.createClient(supabaseUrl, publishableKey, {
  auth: { flowType: 'pkce', storageKey: 'cgcpp-english-auth-v1' },
});

let catalog = new Map();
let publicWords = new Map();
let sentenceRows = [];
let catalogReady = false;
let catalogError = '';
let scope;
let letter = '';
let limit = pageSize;
let editing;
let pendingConfirmation;
let authMode = 'login';
let authBusy = false;

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value != null) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function button(value, action, options = {}) {
  const element = node('button', value);
  element.type = 'button';
  element.disabled = Boolean(options.disabled);
  if (options.pressed != null) element.setAttribute('aria-pressed', String(options.pressed));
  element.addEventListener('click', action);
  return element;
}

function message(text = '', error = false) {
  const box = el('message');
  box.textContent = text;
  box.dataset.error = String(error);
  box.hidden = !text;
}

function canSave() {
  return Boolean(catalogReady && scope?.ready && !scope.busy);
}

function confirmChange(text, accept) {
  if (!canSave()) return;
  pendingConfirmation = { accept, active: scope };
  el('confirm-text').textContent = text;
  confirmation.showModal();
}

el('cancel-confirm').addEventListener('click', () => confirmation.close());
confirmation.addEventListener('close', () => {
  pendingConfirmation = undefined;
  el('confirm-text').textContent = '';
});
el('accept-confirm').addEventListener('click', () => {
  const pending = pendingConfirmation;
  confirmation.close();
  if (pending?.active !== scope) return;
  if (canSave()) pending.accept();
  else message('正在读取保存状态，请稍后重试。', true);
});

function visibleEntries() {
  const entries = new Map([...publicWords].map(([key, base]) => [key, { ...base, key, base }]));
  for (const record of scope?.rows.values() ?? []) {
    const key = record.term_key;
    const base = catalog.get(key);
    const word = record.word ?? base ?? {
      term: key, cn: '原公共词条暂不可用', meaning: '', example: '', category: '个人笔记',
    };
    entries.set(key, { ...word, key, record, base });
  }
  return [...entries.values()];
}

function renderAlphabet() {
  el('alphabet').replaceChildren(...alphabet.map(value => button(value || '全部', () => {
    letter = value;
    limit = pageSize;
    renderAlphabet();
    render();
  }, { pressed: value === letter })));
}

function appendDefinition(parent, word) {
  parent.append(node('p', word.cn, 'translation'));
  if (word.meaning) parent.append(node('p', word.meaning, 'meaning'));
  if (word.example) parent.append(node('pre', word.example, 'example'));
}

function speak(term) {
  if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
    message('当前浏览器不支持朗读。', true);
    return;
  }
  speechSynthesis.cancel();
  const voice = new SpeechSynthesisUtterance(term);
  voice.lang = 'en-US';
  voice.rate = 0.78;
  voice.onerror = event => {
    if (!['interrupted', 'canceled'].includes(event.error)) {
      message('朗读失败。请检查设备的英文语音设置。', true);
    }
  };
  speechSynthesis.speak(voice);
}

function cardFor(entry) {
  const { base, record } = entry;
  const card = node('article', null, 'card');
  card.dataset.term = entry.key;
  const badges = node('div', null, 'badges');
  badges.append(node('span', entry.category, 'badge'));
  if (record?.word) badges.append(node('span', base ? '个人版本' : '个人词条', 'badge'));
  card.append(node('h2', entry.term), badges);
  appendDefinition(card, entry);
  if (record?.word && base) {
    const details = node('details');
    details.append(node('summary', '查看公共释义'));
    appendDefinition(details, base);
    card.append(details);
  }
  if (record?.note) card.append(node('p', '笔记：' + record.note, 'note'));

  const actions = node('div', null, 'actions');
  const locked = !canSave();
  actions.append(
    button('朗读', () => speak(entry.term)),
    button(record?.favorite ? '★ 已收藏' : '☆ 收藏', () => changeRecord(entry.key, record, {
      favorite: !record?.favorite,
    }), { disabled: locked, pressed: Boolean(record?.favorite) }),
    button('笔记', () => openEditor(entry, 'note'), { disabled: locked }),
  );
  if (record?.word || base) {
    actions.append(button(record?.word ? '编辑' : '个人版本', () => openEditor(entry), { disabled: locked }));
  }
  if (record?.word) {
    actions.append(button('删除', () => {
      const text = base ? '删除个人版本并恢复公共释义？' : '删除个人词条「' + entry.term + '」及其收藏和笔记？';
      confirmChange(text, () => changeRecord(entry.key, record,
        base ? { word: null } : { word: null, favorite: false, note: '' }));
    }, { disabled: locked }));
  }
  card.append(actions);
  return card;
}

function render() {
  const all = visibleEntries();
  const query = el('search').value.trim().toLowerCase();
  const exactKey = termKey(query);
  const category = el('category').value;
  const categories = [...new Set(all.map(row => row.category))].sort(sortChinese.compare);
  el('category').replaceChildren(new Option('全部分类', ''),
    ...categories.map(value => new Option(value, value)));
  const selectedCategory = categories.includes(category) ? category : '';
  el('category').value = selectedCategory;
  const filter = el('filter').value;
  const shown = all.filter(entry => {
    const first = /^[A-Z]/i.test(entry.term) ? entry.term[0].toUpperCase() : '#';
    return (!query || searchMatches(entry, query))
      && (!selectedCategory || selectedCategory === entry.category)
      && (!letter || letter === first)
      && (filter !== 'favorite' || entry.record?.favorite)
      && (filter !== 'personal' || entry.record?.word || entry.record?.note);
  }).sort((a, b) => Number(b.key === exactKey) - Number(a.key === exactKey)
    || sortEnglish.compare(a.term, b.term));

  const favorites = all.filter(row => row.record?.favorite).length;
  el('count').textContent = catalogError || (catalogReady
    ? '匹配 ' + shown.length + ' / ' + all.length + ' 条 · 公共 ' + publicWords.size + ' 条 · 收藏 ' + favorites + ' 条'
    : '正在加载公共词库…');
  el('cards').replaceChildren(...shown.slice(0, limit).map(cardFor));
  if (catalogReady && !shown.length) el('cards').append(node('p', '没有匹配的词条。'));
  el('more').hidden = shown.length <= limit;
  el('sync-status').textContent = scope?.status ?? '正在读取保存状态…';
  el('profile').textContent = scope?.userId ? '已登录' : scope ? '访客模式' : '正在连接…';
  el('sign-in').hidden = Boolean(scope?.userId);
  el('sign-in').disabled = !client || !scope || scope.busy || authBusy;
  el('sign-out').hidden = !scope?.userId;
  el('sign-out').disabled = Boolean(scope?.busy || authBusy);
  el('sync').hidden = !scope?.userId;
  el('sync').disabled = Boolean(scope?.busy);
  el('add').disabled = !canSave();
  el('export').disabled = !scope?.ready || Boolean(scope?.busy);
  el('import-file').disabled = !canSave();
  el('merge-guest').hidden = !scope?.userId;
  el('merge-guest').disabled = !canSave();
}

function finishOperation(active) {
  active.busy = false;
  if (active !== scope) return;
  if (active.refreshPending) {
    active.refreshPending = false;
    void refresh(active);
  } else {
    render();
  }
}

async function refresh(active = scope) {
  if (!active || active.busy || active !== scope) return;
  active.busy = true;
  active.lastRead = Date.now();
  active.status = active.userId ? '正在读取云端个人数据…' : '正在读取本机数据…';
  render();
  try {
    active.rows = await active.store.read();
    active.ready = true;
    active.status = active.userId ? '云端数据已读取。' : '访客数据保存在当前浏览器。';
  } catch (error) {
    active.ready = false;
    active.status = error instanceof Error ? error.message : '读取保存数据失败。';
  } finally {
    finishOperation(active);
  }
}

function chooseScope(userId) {
  if (scope?.userId === userId) return;
  if (editor.open) editor.close();
  if (confirmation.open) confirmation.close();
  wordForm.reset();
  el('editor-status').textContent = '';
  el('editor-title').textContent = '添加词条';
  editing = undefined;
  pendingConfirmation = undefined;
  el('search').value = '';
  el('category').value = '';
  el('filter').value = 'all';
  message();
  scope = {
    userId,
    store: userId ? cloudStore(client, userId) : guest,
    rows: new Map(),
    ready: false,
    busy: false,
    status: '',
  };
  void refresh();
}

async function write(work, report = message) {
  if (!canSave()) return;
  const active = scope;
  active.busy = true;
  render();
  try {
    await work(active);
  } catch (error) {
    if (active === scope) report(error.message || '保存失败。', true);
  } finally {
    finishOperation(active);
  }
}

async function saveRow(active, key, before, change) {
  const row = personalRecord(key, { ...before, ...change });
  if (sameContent(before, row) || (!before && !row.word && !row.note && !row.favorite)) return false;
  const result = await active.store.save(row, before);
  if (before) active.rows.delete(before.term_key);
  if (result) active.rows.set(result.term_key, result);
  return true;
}

function changeRecord(key, before, change) {
  message();
  void write(async active => {
    await saveRow(active, key, before, change);
    if (active === scope) message(active.userId ? '已保存到云端。' : '已保存在当前浏览器。');
  });
}

function openEditor(entry, mode = 'word') {
  if (!canSave()) return;
  editing = { entry, mode };
  wordForm.reset();
  el('editor-status').textContent = '';
  el('refresh-edit').hidden = true;
  el('word-fields').hidden = mode === 'note';
  for (const field of fields) {
    const input = wordForm.elements.namedItem(field);
    input.disabled = mode === 'note';
    input.value = entry?.[field] ?? '';
  }
  wordForm.elements.term.readOnly = Boolean(entry?.base);
  wordForm.elements.note.value = entry?.record?.note ?? '';
  el('editor-title').textContent = mode === 'note' ? '私人笔记 · ' + entry.term
    : !entry ? '添加词条' : entry.record?.word ? '编辑个人词条' : '添加个人版本';
  editor.showModal();
  (mode === 'note' ? wordForm.elements.note : wordForm.elements.term).focus();
}

wordForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!editing) return;
  if (!canSave()) {
    el('editor-status').textContent = scope?.busy
      ? '正在处理数据，请稍后重试。'
      : scope?.status || '保存状态暂不可用。';
    el('refresh-edit').hidden = !scope?.userId;
    return;
  }
  const { entry, mode } = editing;
  const errorBox = el('editor-status');
  const submit = wordForm.querySelector('button[type=submit]');
  const values = Object.fromEntries(new FormData(wordForm));
  const note = values.note.trim();
  message();
  errorBox.textContent = '正在保存…';
  submit.disabled = true;
  el('cancel-edit').disabled = true;
  void write(async active => {
    try {
      const word = mode === 'note' ? entry.record?.word ?? null : wordFrom({
        ...values, term: values.term.trim(), cn: values.cn.trim(), category: values.category.trim(),
      });
      const key = mode === 'note' ? entry.key : termKey(word.term);
      if (key !== entry?.key && (catalog.has(key) || active.rows.has(key))) {
        throw new Error('这个英文词条已经存在。请在原词条添加笔记或个人版本。');
      }
      const saved = await saveRow(active, key, entry?.record, { word, note });
      if (active === scope) {
        editor.close();
        message(!saved ? '没有需要保存的更改。' : active.userId ? '已保存到云端。' : '已保存在当前浏览器。');
      }
    } finally {
      submit.disabled = false;
      el('cancel-edit').disabled = false;
    }
  }, text => {
    errorBox.textContent = text;
    el('refresh-edit').hidden = !scope?.userId;
  });
});

editor.addEventListener('close', () => {
  wordForm.reset();
  el('editor-status').textContent = '';
  el('editor-title').textContent = '添加词条';
  editing = undefined;
});
editor.addEventListener('cancel', event => {
  if (wordForm.querySelector('button[type=submit]').disabled) event.preventDefault();
});
el('cancel-edit').addEventListener('click', () => editor.close());
el('refresh-edit').addEventListener('click', async () => {
  if (!editor.open || scope.busy) return;
  const active = scope;
  await refresh(active);
  if (active === scope && editor.open) {
    el('editor-status').textContent = active.status
      + ' 表单保留了你的草稿。需要比较版本时，复制草稿并关闭后再打开词条。';
  }
});

function downloadBackup(rows) {
  const data = makeBackup(rows.values());
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], {
    type: 'application/json;charset=utf-8',
  }));
  const link = node('a');
  link.href = url;
  link.download = 'CG_CPP_Personal_' + data.exported_at.replace(/[:.]/g, '-') + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function mergeBackup(backup) {
  const count = backup.rows.length;
  if (!count) {
    message('备份内没有需要迁移的个人数据。已识别 ' + backup.unchanged + ' 条未修改的公共词条。');
    return;
  }
  confirmChange('合并 ' + count + ' 条个人记录？将先下载当前数据的 JSON 备份。', () => applyBackup(backup));
}

function applyBackup(backup) {
  void write(async active => {
    downloadBackup(active.rows);
    let saved = 0;
    const conflicts = [];
    for (const incoming of backup.rows) {
      if (active !== scope) return;
      const current = active.rows.get(incoming.term_key);
      const { row, conflict } = mergeRecord(current, incoming);
      if (conflict) conflicts.push(row.term_key);
      if (sameContent(current, row)) continue;
      try {
        await saveRow(active, row.term_key, current, row);
        saved++;
      } catch (error) {
        throw new Error('已确认 ' + saved + ' 条。处理「' + row.term_key + '」时中断。' + error.message);
      }
    }
    if (active === scope) {
      const detail = conflicts.length
        ? ' 保留了 ' + conflicts.length + ' 条现有版本（' + conflicts.slice(0, 6).join('、') + '），请保留原备份。'
        : '';
      const dedup = backup.duplicates ? ' 合并了文件内 ' + backup.duplicates + ' 条重复记录。' : '';
      message('合并完成，保存 ' + saved + ' 条。' + detail + dedup, conflicts.length > 0);
    }
  });
}

el('export').addEventListener('click', () => {
  downloadBackup(scope.rows);
  message('已生成个人词条、收藏及笔记备份。');
});
el('import-file').addEventListener('change', async event => {
  const active = scope;
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (!canSave()) throw new Error('请在同步完成后重新选择备份。');
    if (file.size > 25_000_000) throw new Error('请使用 25 MB 以内的备份。');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (active !== scope) {
      message('账号已切换，请为当前账号重新选择备份。', true);
      return;
    }
    if (!canSave()) throw new Error('请在同步完成后重新选择备份。');
    mergeBackup(readBackup(text, catalog));
  } catch (error) {
    if (active === scope) message('导入失败。' + error.message, true);
  }
});
el('merge-guest').addEventListener('click', () => {
  try {
    mergeBackup({ rows: [...guest.read().values()], unchanged: 0, duplicates: 0 });
  } catch (error) {
    message('无法读取访客数据。' + error.message, true);
  }
});

function showAuth(mode) {
  authMode = mode;
  const titles = { login: '邮箱登录', register: '注册账号', recover: '发送重置密码邮件', password: '设置新密码' };
  const titlesButton = { login: '登录', register: '注册', recover: '发送邮件', password: '保存新密码' };
  el('auth-title').textContent = titles[mode];
  el('auth-submit').textContent = titlesButton[mode];
  el('auth-status').textContent = '';
  el('email-field').hidden = mode === 'password';
  authForm.elements.email.disabled = mode === 'password';
  el('password-field').hidden = mode === 'recover';
  authForm.elements.password.disabled = mode === 'recover';
  authForm.elements.password.value = '';
  authForm.elements.password.minLength = ['password', 'register'].includes(mode) ? 8 : 0;
  authForm.elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  el('auth-options').hidden = mode === 'password';
  el('auth-login').hidden = mode === 'login';
  el('auth-register').hidden = mode === 'register';
  el('auth-recover').hidden = mode === 'recover';
  if (!authDialog.open) authDialog.showModal();
  (mode === 'password' ? authForm.elements.password : authForm.elements.email).focus();
}

function setAuthBusy(value) {
  authBusy = value;
  for (const control of authForm.querySelectorAll('button')) control.disabled = value;
  render();
}

function authError(error) {
  if (error.code === 'invalid_credentials') return '邮箱或密码不正确。';
  if (error.code === 'email_not_confirmed') return '请先在邮件中确认账号。';
  if (error.status === 429) return '邮件发送或登录请求太频繁，请稍后重试。';
  if (error.code === 'weak_password') return '密码强度不足，请使用至少 8 位并增加字符种类。';
  if (authMode === 'register' || authMode === 'recover') {
    return '邮件请求失败。请检查网络，或请维护者检查 Supabase 邮件配置。';
  }
  return '账号操作失败。请检查网络后重试。';
}

authForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!client || authBusy) return;
  const mode = authMode;
  const { email, password } = Object.fromEntries(new FormData(authForm));
  setAuthBusy(true);
  el('auth-status').textContent = '正在处理…';
  try {
    let result;
    if (mode === 'recover') {
      result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: siteUrl });
    } else if (mode === 'register') {
      result = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: siteUrl } });
    } else if (mode === 'password') {
      result = await client.auth.updateUser({ password });
    } else {
      result = await client.auth.signInWithPassword({ email: email.trim(), password });
    }
    if (result.error) {
      el('auth-status').textContent = authError(result.error);
      return;
    }
    if (mode === 'recover' || (mode === 'register' && !result.data.session)) {
      el('auth-status').textContent = '请查收邮件，并在当前浏览器中打开确认链接。';
      authForm.elements.password.value = '';
    } else {
      authDialog.close();
      if (mode === 'password') message('密码已更新。');
    }
  } catch {
    el('auth-status').textContent = '账号请求未完成。请检查网络后重试。';
  } finally {
    setAuthBusy(false);
  }
});

authDialog.addEventListener('close', () => { authForm.elements.password.value = ''; });
authDialog.addEventListener('cancel', event => { if (authBusy) event.preventDefault(); });
el('cancel-auth').addEventListener('click', () => authDialog.close());
el('sign-in').addEventListener('click', () => showAuth('login'));
el('auth-login').addEventListener('click', () => showAuth('login'));
el('auth-register').addEventListener('click', () => showAuth('register'));
el('auth-recover').addEventListener('click', () => showAuth('recover'));
el('sign-out').addEventListener('click', async () => {
  setAuthBusy(true);
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) message('退出未完成。请检查网络后重试。', true);
  } catch {
    message('退出未完成。请检查网络后重试。', true);
  } finally {
    setAuthBusy(false);
  }
});

el('sync').addEventListener('click', () => { message(); void refresh(); });
el('add').addEventListener('click', () => openEditor());
el('more').addEventListener('click', () => { limit += pageSize; render(); });
for (const [id, event] of [['search', 'input'], ['category', 'change'], ['filter', 'change']]) {
  el(id).addEventListener(event, () => { limit = pageSize; render(); });
}
el('reset').addEventListener('click', () => {
  el('search').value = '';
  el('category').value = '';
  el('filter').value = 'all';
  letter = '';
  limit = pageSize;
  renderAlphabet();
  render();
  el('search').focus();
});
window.addEventListener('storage', event => {
  if (!scope || scope.userId || event.key !== guestKey) return;
  if (scope.busy) scope.refreshPending = true;
  else void refresh();
});
window.addEventListener('focus', () => {
  if (scope?.userId && Date.now() - scope.lastRead > 5000) void refresh();
});
window.addEventListener('online', () => { if (scope?.userId) void refresh(); });

renderAlphabet();
if (client) {
  client.auth.onAuthStateChange((event, session) => {
    chooseScope(session?.user?.id ?? null);
    if (event === 'PASSWORD_RECOVERY') showAuth('password');
  });
} else {
  chooseScope(null);
  message('登录组件未加载，访客模式可用。请重新加载页面。', true);
}
void sentenceCatalog.then(rows => {
  sentenceRows = rows;
  publicWords = wordPanelCatalog(catalog, sentenceRows);
  render();
});
try {
  const response = await fetch(new URL('./words.json', import.meta.url), { cache: 'no-cache' });
  if (!response.ok) throw new Error('Catalog unavailable');
  catalog = validateCatalog(await response.json());
  publicWords = wordPanelCatalog(catalog, sentenceRows);
  catalogReady = true;
} catch {
  catalogError = '公共词库加载失败，请刷新页面。';
}
render();
