import { readFile } from 'node:fs/promises';
import { validateCatalog } from './core.js';
import { validateSentences, wordPanelCatalog } from './sentence-core.js';

try {
  const text = await readFile(new URL('./words.json', import.meta.url), 'utf8');
  if (text.includes('\ufffd')) throw new Error('公共词库含 Unicode 替换字符，请检查 UTF-8 编码。');
  const catalog = validateCatalog(JSON.parse(text));
  const sentencesText = await readFile(new URL('./sentences.json', import.meta.url), 'utf8');
  if (sentencesText.includes('\ufffd')) throw new Error('句子库存在损坏的 UTF-8 字符。');
  const sentences = validateSentences(JSON.parse(sentencesText));
  const words = wordPanelCatalog(catalog, sentences);
  if (process.argv.includes('--counts')) {
    console.log(words.size + ' ' + sentences.length);
  } else {
    console.log('Validated ' + words.size + ' public words across ' + catalog.size + ' catalog records.');
    console.log('Validated ' + sentences.length + ' unique English sentences.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
