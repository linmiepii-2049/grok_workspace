// 輪播渲染共用：套版型（themes/<id>/）+ 帳號資料（profile.json）+ 貼文 JSON，輸出每頁 PNG
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_THEME = 'beige-teal';

const readJson = async f => JSON.parse(await readFile(f, 'utf8'));

export const listThemes = async () =>
  (await readdir(join(here, 'themes'), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort();

// 圖片路徑相對於 carousel/；模板在 themes/<id>/ 底下，所以轉成絕對網址。找不到就退回不放照片的版本
const asset = f => {
  if (!f) return undefined;
  if (existsSync(join(here, f))) return pathToFileURL(join(here, f)).href;
  console.warn(`⚠ 找不到圖片 ${f}，先用替代版面`);
};

export async function renderPost(post, outDir, themeId = post.theme ?? DEFAULT_THEME) {
  const dir = join(here, 'themes', themeId);
  if (!existsSync(join(dir, 'theme.json'))) throw new Error(`沒有版型 ${themeId}，可用：${(await listThemes()).join('、')}`);
  const theme = { ...(await readJson(join(dir, 'theme.json'))), ...(await readJson(join(here, 'profile.json'))) };
  theme.avatar = asset(theme.avatar);
  post = { ...post, slides: post.slides.map(s => ({ ...s, photo: asset(s.photo) })) };

  const [w, h] = theme.size;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(pathToFileURL(join(dir, 'template.html')).href);
  await page.addStyleTag({ url: theme.fonts.css });
  await page.evaluate(([t, p]) => window.render(t, p), [theme, post]);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const fits = await page.evaluate(s => window.settleAll(s), theme.fonts.titleStretch);

  await mkdir(outDir, { recursive: true });
  const files = [];
  for (const [i, el] of (await page.$$('.slide')).entries()) {
    const file = join(outDir, `${String(i + 1).padStart(2, '0')}.png`);
    await el.screenshot({ path: file });
    const { k, overflow } = fits[i];
    const warn = overflow ? '  ⚠ 字太多，縮到最小仍超出' : k < 1 ? `  （字級縮為 ${Math.round(k * 100)}%）` : '';
    console.log(file + warn);
    files.push(file);
  }
  await browser.close();
  return { theme, files };
}

export const loadPost = readJson;
