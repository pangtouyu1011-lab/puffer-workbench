import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2] || new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-release-1';
if (!/^[a-z0-9][a-z0-9.-]*$/i.test(version)) throw new Error('版本号只能包含字母、数字、点和连字符。');

const indexPath = new URL('../index.html', import.meta.url);
const versionPath = new URL('../version.json', import.meta.url);
let index = await readFile(indexPath, 'utf8');
index = index.replace(/const pageVersion = '[^']+';/, `const pageVersion = '${version}';`);
index = index.replace(/(href|src)="([^"]+?)(\?v=)[^"]+"/g, `$1="$2$3${version}"`);
await writeFile(indexPath, index, 'utf8');
await writeFile(versionPath, JSON.stringify({ version }, null, 2) + '\n', 'utf8');
console.log(`版本已更新为 ${version}`);
