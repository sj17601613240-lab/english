import { readFile } from 'node:fs/promises';
import { validateCatalog } from './core.js';

try {
  const text = await readFile(new URL('./words.json', import.meta.url), 'utf8');
  if (text.includes('\ufffd')) throw new Error('公共词库含 Unicode 替换字符，请检查 UTF-8 编码。');
  const catalog = validateCatalog(JSON.parse(text));
  console.log('Validated ' + catalog.size + ' unique public words.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
