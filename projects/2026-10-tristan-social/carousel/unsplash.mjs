// 用法：
//   node unsplash.mjs search "manager explaining new employee"   列出候選照片
//   node unsplash.mjs get <photo-id> assets/<檔名>.jpg            下載，並在旁邊存作者資訊 .credit.json
// 需要環境變數 UNSPLASH_ACCESS_KEY，網路白名單要有 api.unsplash.com、images.unsplash.com
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const key = process.env.UNSPLASH_ACCESS_KEY;
if (!key) throw new Error('沒有 UNSPLASH_ACCESS_KEY，請在雲端環境設定裡加上');
const here = dirname(fileURLToPath(import.meta.url));

const api = async path => {
  const res = await fetch('https://api.unsplash.com' + path, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
  if (!res.ok) throw new Error(`Unsplash API ${res.status}：${await res.text()}`);
  return res.json();
};

const [cmd, arg, out] = process.argv.slice(2);
if (cmd === 'search') {
  const { results } = await api(`/search/photos?query=${encodeURIComponent(arg)}&per_page=12&content_filter=high`);
  for (const p of results) console.log([p.id, `${p.width}x${p.height}`, p.user.name, p.alt_description ?? '', p.urls.small].join('\t'));
} else if (cmd === 'get') {
  const p = await api(`/photos/${arg}`);
  // API 規範：使用照片時要呼叫 download_location 回報下載
  await api(new URL(p.links.download_location).pathname + new URL(p.links.download_location).search);
  const img = await fetch(p.urls.raw + '&w=1600&fm=jpg&q=85');
  await writeFile(join(here, out), Buffer.from(await img.arrayBuffer()));
  const credit = { id: p.id, author: p.user.name, profile: p.user.links.html, photo: p.links.html };
  await writeFile(join(here, out.replace(/\.\w+$/, '.credit.json')), JSON.stringify(credit, null, 2) + '\n');
  console.log(`${out}  Photo by ${credit.author} on Unsplash`);
} else {
  console.log('用法：node unsplash.mjs search "<關鍵字>" | get <photo-id> assets/<檔名>.jpg');
}
