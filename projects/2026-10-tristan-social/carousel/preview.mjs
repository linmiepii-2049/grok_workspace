// 用法：node preview.mjs [版型 id …]   不給 id 就全部重做
// 用 posts/01-prompt-new-hire.json 當示範文案，每套版型輸出一張總覽圖到 ../outputs/templates/<id>.png
// 推上 GitHub 後會自動歸檔，在 jteam-viewer 看檔名就是版型 id
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { here, listThemes, loadPost, renderPost } from './lib.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const sample = await loadPost(join(here, 'posts', '01-prompt-new-hire.json'));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : await listThemes();
const outDir = join(here, '..', 'outputs', 'templates');
await mkdir(outDir, { recursive: true });

for (const id of ids) {
  const tmp = await mkdtemp(join(tmpdir(), `theme-${id}-`));
  const { theme, files } = await renderPost(sample, tmp, id);
  const imgs = await Promise.all(files.map(async f => `<img src="data:image/png;base64,${(await readFile(f)).toString('base64')}">`));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } });
  await page.setContent(`<style>
    body { margin: 0; padding: 48px; background: #2b2a29; color: #f5f2ee; font: 500 40px/1.2 sans-serif; }
    h1 { margin: 0 0 32px; font-size: 56px; } h1 small { margin-left: 24px; font-size: 36px; color: #b9b2aa; font-weight: 400; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; } img { width: 100%; display: block; }
  </style><h1>${id}<small>${theme.name ?? ''}</small></h1><div class="grid">${imgs.join('')}</div>`);
  const file = join(outDir, `${id}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await browser.close();
  await rm(tmp, { recursive: true });
  console.log(`版型預覽：${file}`);
}
