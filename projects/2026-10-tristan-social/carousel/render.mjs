// 用法：node render.mjs posts/01-prompt-new-hire.json [版型 id]
// 版型 id 依序取：指令參數 → 貼文 JSON 的 "theme" → beige-teal
// 輸出到 ../outputs/carousel/<貼文檔名>/01.png…
import { basename, join, resolve } from 'node:path';
import { here, loadPost, renderPost } from './lib.mjs';

const postPath = resolve(process.argv[2] ?? '');
const post = await loadPost(postPath);
await renderPost(post, join(here, '..', 'outputs', 'carousel', basename(postPath, '.json')), process.argv[3]);
