import { sentenceMatches, validateSentences } from './sentence-core.js';
export { wordPanelCatalog } from './sentence-core.js';

const $ = id => document.getElementById(id);
const pageSize = 18;
const collator = new Intl.Collator('zh-CN');
let data = [];
let limit = pageSize;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, action) {
  const element = node('button', text);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}

function status(text) {
  $('sentence-message').textContent = text;
}

function speakEnglish(text) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    status('当前浏览器不支持朗读。');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.8;
  utterance.onerror = event => {
    if (!['interrupted', 'canceled'].includes(event.error)) status('朗读失败，请检查英语语音设置。');
  };
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    status('英文已复制。');
  } catch {
    status('无法直接复制。请选中英文句子手动复制。');
  }
}

function sentenceCard(record, openWordSearch) {
  const card = node('article', null, 'sentence-card');
  const tags = node('div', null, 'badges');
  tags.append(node('span', record.lesson, 'badge'), node('span', record.kind, 'badge'));
  const title = node('h3', record.english);
  title.lang = 'en';
  card.append(tags, title, node('p', record.cn, 'sentence-translation'));
  if (record.note) card.append(node('p', record.note, 'sentence-note'));
  if (record.code) {
    const code = node('pre', record.code, 'example sentence-code');
    code.setAttribute('aria-label', '相关 C++ 代码');
    card.append(code);
  }

  const details = node('details', null, 'sentence-words');
  details.append(node('summary', '逐词解释（' + record.words.length + ' 个词）'));
  const breakdown = node('div', null, 'sentence-breakdown');
  for (const word of record.words) {
    const item = node('div', null, 'sentence-token');
    const lookup = button(word.en, () => openWordSearch(word.en));
    lookup.lang = 'en';
    item.append(lookup, node('span', word.cn));
    breakdown.append(item);
  }
  details.append(breakdown);

  const actions = node('div', null, 'sentence-actions');
  actions.append(button('朗读整句', () => speakEnglish(record.english)),
    button('复制英文', () => void copyText(record.english)));
  card.append(details, actions);
  return card;
}

function render(openWordSearch) {
  if (!data.length) return;
  const query = $('sentence-search').value;
  const lesson = $('sentence-lesson').value;
  const kind = $('sentence-kind').value;
  const matches = data.filter(row => sentenceMatches(row, query)
    && (!lesson || row.lesson === lesson) && (!kind || row.kind === kind));
  $('sentence-count').textContent = '匹配 ' + matches.length + ' / ' + data.length + ' 句';
  $('sentence-cards').replaceChildren(...matches.slice(0, limit).map(row => sentenceCard(row, openWordSearch)));
  if (!matches.length) $('sentence-cards').append(node('p', '没有匹配的句子。可以清除筛选后重试。'));
  $('sentence-more').hidden = matches.length <= limit;
}

export async function loadSentences(openWordSearch) {
  const draw = () => render(openWordSearch);
  for (const [id, event] of [['sentence-search', 'input'], ['sentence-lesson', 'change'], ['sentence-kind', 'change']]) {
    $(id).addEventListener(event, () => {
      limit = pageSize;
      draw();
    });
  }
  $('sentence-reset').addEventListener('click', () => {
    $('sentence-search').value = '';
    $('sentence-lesson').value = '';
    $('sentence-kind').value = '';
    limit = pageSize;
    draw();
    $('sentence-search').focus();
  });
  $('sentence-more').addEventListener('click', () => {
    limit += pageSize;
    draw();
  });

  try {
    const response = await fetch(new URL('./sentences.json', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error('Sentence catalog unavailable');
    const rows = validateSentences(await response.json());
    const lessons = [...new Set(rows.map(row => row.lesson))].sort(collator.compare);
    const kinds = [...new Set(rows.map(row => row.kind))].sort(collator.compare);
    $('sentence-lesson').append(...lessons.map(value => new Option(value, value)));
    $('sentence-kind').append(...kinds.map(value => new Option(value, value)));
    data = rows;
    status('展开逐词解释后，点击英文单词即可跳转到词库。');
    draw();
    return rows;
  } catch {
    $('sentence-count').textContent = '句子库加载失败';
    status('请刷新网页后重试。');
    return [];
  }
}
