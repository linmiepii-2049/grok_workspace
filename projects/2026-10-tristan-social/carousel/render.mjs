// 用法：node render.mjs posts/01-prompt-new-hire.json
// 依 theme.json + 貼文 JSON 套 template.html，輸出到 ../outputs/carousel/<貼文檔名>/01.png…
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const postPath = resolve(process.argv[2] ?? '');
const theme = JSON.parse(await readFile(join(here, 'theme.json'), 'utf8'));
const post = JSON.parse(await readFile(postPath, 'utf8'));
const outDir = join(here, '..', 'outputs', 'carousel', basename(postPath, '.json'));

// 圖片路徑相對於 carousel/；找不到就退回不放照片的版本
const missing = f => f && !existsSync(join(here, f)) && (console.warn(`⚠ 找不到圖片 ${f}，先用替代版面`), true);
if (missing(theme.avatar)) delete theme.avatar;
for (const s of post.slides) if (missing(s.photo)) delete s.photo;

const [w, h] = theme.size;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto(pathToFileURL(join(here, 'template.html')).href);
await page.addStyleTag({ url: theme.fonts.css });
await page.evaluate(([t, p]) => window.render(t, p), [theme, post]);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const fits = await page.evaluate(s => window.settleAll(s), theme.fonts.titleStretch);

await mkdir(outDir, { recursive: true });
const slides = await page.$$('.slide');
for (const [i, el] of slides.entries()) {
  const file = join(outDir, `${String(i + 1).padStart(2, '0')}.png`);
  await el.screenshot({ path: file });
  const { k, overflow } = fits[i];
  const warn = overflow ? '  ⚠ 字太多，縮到最小仍超出' : k < 1 ? `  （字級縮為 ${Math.round(k * 100)}%）` : '';
  console.log(file + warn);
}
await browser.close();
