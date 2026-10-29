#!/usr/bin/env node
// 依 voiceover.json 產生每一行旁白的 mp3 與逐字時間碼。provider：minimax（中文預設）或 elevenlabs（英文預設）。
// 內容沒變的行會跳過，不重新計費。格式見 references/audio.md。
// 用法：node scripts/tts.mjs <voiceover.json> [--only <id 前綴>] [--dry-run]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const configPath = args.find((a) => !a.startsWith("--"));
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const dryRun = args.includes("--dry-run");
if (!configPath || !existsSync(configPath)) {
  console.error("用法：node scripts/tts.mjs <voiceover.json> [--only <id 前綴>] [--dry-run]");
  process.exit(2);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const provider = config.provider ?? "elevenlabs";
for (const key of ["voice_id", "model_id", "output_dir", "lines"]) {
  if (!config[key]) {
    console.error(`voiceover.json 缺少 ${key}`);
    process.exit(2);
  }
}
const outDir = resolve(dirname(configPath), config.output_dir);
const lines = config.lines;
const ids = new Set();
for (const l of lines) {
  if (!l.id || !l.text) {
    console.error(`每一行都要有 id 和 text：${JSON.stringify(l)}`);
    process.exit(2);
  }
  if (ids.has(l.id)) {
    console.error(`id 重複：${l.id}`);
    process.exit(2);
  }
  ids.add(l.id);
}

// 密鑰只從環境變數或 macOS 鑰匙圈讀，不從檔案或指令列參數讀
const readKey = (name) => {
  if (process.env[name]) return process.env[name];
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync("security", ["find-generic-password", "-s", name, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

// elevenlabs 沿用舊的 hash 欄位，已產生的旁白不會因為改版而重新計費
const hashOf = (line) => {
  const parts = [line.text, config.voice_id, config.model_id, config.voice_settings ?? null];
  if (provider !== "elevenlabs") parts.push(provider, config.language_boost ?? null);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
};

const isFresh = (line) => {
  const timing = join(outDir, `${line.id}.timing.json`);
  if (!existsSync(timing) || !existsSync(join(outDir, `${line.id}.mp3`))) return false;
  try {
    return JSON.parse(readFileSync(timing, "utf8")).hash === hashOf(line);
  } catch {
    return false;
  }
};

const mp3Duration = (file, fallback) => {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
      encoding: "utf8",
    });
    return Number(Number(out).toFixed(3)) || fallback;
  } catch {
    return fallback;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 限流與暫時性錯誤退避重試；其他錯誤直接回報，因為重試也不會成功
const withRetry = async (id, fn) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!e.retryable || attempt === 4) throw new Error(`${id}：${e.message}${e.retryable ? "（重試 4 次仍失敗）" : ""}`);
      await sleep(2000 * 2 ** attempt);
    }
  }
};
const fail = (message, retryable) => Object.assign(new Error(message), { retryable });

// 每個 provider 回傳 { audio: Buffer, chars: [{ c, start, end }] }，時間單位為秒，chars 對齊原文每一個字元
const providers = {
  elevenlabs: {
    keyName: "ELEVENLABS_API_KEY",
    async synthesize(key, line, i) {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.voice_id}/with-timestamps?output_format=mp3_44100_128`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          text: line.text,
          model_id: config.model_id,
          voice_settings: config.voice_settings,
          // 前後句讓語調連貫
          previous_text: lines[i - 1]?.text,
          next_text: lines[i + 1]?.text,
        }),
      });
      if (!res.ok) throw fail(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`, res.status === 429 || res.status >= 500);
      const data = await res.json();
      const a = data.alignment ?? data.normalized_alignment;
      if (!data.audio_base64 || !a) throw fail("回應缺少 audio_base64 或 alignment", false);
      return {
        audio: Buffer.from(data.audio_base64, "base64"),
        chars: a.characters.map((c, k) => ({ c, start: a.character_start_times_seconds[k], end: a.character_end_times_seconds[k] })),
      };
    },
  },

  minimax: {
    keyName: "MINIMAX_API_KEY",
    async synthesize(key, line) {
      // 國際版 api.minimax.io；中國大陸帳號用 api.minimaxi.com，設定 MINIMAX_API_HOST
      const host = process.env.MINIMAX_API_HOST || "https://api.minimax.io";
      const res = await fetch(`${host}/v1/t2a_v2`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: config.model_id,
          text: line.text,
          stream: false,
          voice_setting: { voice_id: config.voice_id, speed: 1, vol: 1, pitch: 0, ...config.voice_settings },
          audio_setting: { sample_rate: 44100, bitrate: 128000, format: "mp3", channel: 1 },
          language_boost: config.language_boost ?? "Chinese",
          subtitle_enable: true,
          subtitle_type: "word",
          output_format: "hex",
        }),
      });
      if (!res.ok) throw fail(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`, res.status === 429 || res.status >= 500);
      const data = await res.json();
      const code = data.base_resp?.status_code;
      // 1001 逾時、1002 與 1039 限流可以重試；1004 驗證失敗、2013 參數錯誤不行
      if (code !== 0) throw fail(`MiniMax ${code} ${data.base_resp?.status_msg ?? ""}`, [1000, 1001, 1002, 1039].includes(code));
      if (!data.data?.audio) throw fail("回應缺少 data.audio", false);
      const audio = Buffer.from(data.data.audio, "hex");
      let segments = [];
      if (data.data.subtitle_file) {
        const sub = await fetch(data.data.subtitle_file);
        if (sub.ok) segments = await sub.json();
      }
      const lengthSec = (data.extra_info?.audio_length ?? 0) / 1000;
      return { audio, chars: minimaxChars(line.text, Array.isArray(segments) ? segments : [], lengthSec) };
    },
  },
};

// MiniMax 給的是句子與詞的時間，換算成原文每個字元的時間：
// 有詞時間就在詞內平均分配，否則在句子內平均分配；對不到的字元（標點）沿用前一個字的結束時間
const minimaxChars = (text, segments, lengthSec) => {
  const times = Array.from(text, () => null);
  for (const seg of segments) {
    const sb = seg.text_begin ?? 0;
    const se = Math.min(seg.text_end ?? text.length, text.length);
    const spread = (from, to, t0, t1) => {
      for (let k = from; k < to; k++) {
        times[k] = { start: t0 + ((t1 - t0) * (k - from)) / (to - from), end: t0 + ((t1 - t0) * (k - from + 1)) / (to - from) };
      }
    };
    const words = seg.timestamped_words ?? [];
    if (words.length) {
      let cursor = sb;
      for (const w of words) {
        const at = text.indexOf(w.word, cursor);
        if (at < 0 || at >= se) continue;
        spread(at, at + w.word.length, w.time_begin / 1000, w.time_end / 1000);
        cursor = at + w.word.length;
      }
    } else {
      spread(sb, se, seg.time_begin / 1000, seg.time_end / 1000);
    }
  }
  // 完全沒有時間資料時，整句平均分配，vo-timeline 仍可用
  if (times.every((t) => !t)) {
    return Array.from(text, (c, k) => ({
      c,
      start: +((lengthSec * k) / text.length).toFixed(3),
      end: +((lengthSec * (k + 1)) / text.length).toFixed(3),
    }));
  }
  let last = 0;
  return Array.from(text, (c, k) => {
    const t = times[k] ?? { start: last, end: last };
    last = t.end;
    return { c, start: +t.start.toFixed(3), end: +t.end.toFixed(3) };
  });
};

const impl = providers[provider];
if (!impl) {
  console.error(`不支援的 provider：${provider}（可用：${Object.keys(providers).join("、")}）`);
  process.exit(2);
}

const targets = lines.filter((l) => l.id.startsWith(only));
const todo = targets.filter((l) => !isFresh(l));
console.log(`旁白（${provider}）：${targets.length} 行，需要產生 ${todo.length} 行，跳過 ${targets.length - todo.length} 行（內容沒變）`);
if (dryRun) {
  todo.forEach((l) => console.log(`  - ${l.id}（${l.text.length} 字）`));
  process.exit(0);
}

if (todo.length) {
  const key = readKey(impl.keyName);
  if (!key) {
    console.error(`沒有 ${impl.keyName}。本機：存進鑰匙圈（見 references/audio.md）；雲端：commit 並推上 voiceover.json，由 tts workflow 產生`);
    process.exit(3);
  }
  mkdirSync(outDir, { recursive: true });
  for (const line of todo) {
    let result;
    try {
      result = await withRetry(line.id, () => impl.synthesize(key, line, lines.indexOf(line)));
    } catch (e) {
      // 已完成的行都存好了，修正問題（例如儲值）後重跑只會補剩下的行
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
    const { audio, chars } = result;
    const mp3 = join(outDir, `${line.id}.mp3`);
    writeFileSync(mp3, audio);
    const duration = mp3Duration(mp3, chars.at(-1)?.end ?? 0);
    writeFileSync(join(outDir, `${line.id}.timing.json`), JSON.stringify({ hash: hashOf(line), duration, chars }));
    console.log(`  ✓ ${line.id}（${duration}s）`);
  }
}

// index.json 依順序列出每一行的長度，排時間軸時只要讀這一個小檔
const index = lines
  .filter((l) => existsSync(join(outDir, `${l.id}.timing.json`)))
  .map((l) => ({
    id: l.id,
    file: `${l.id}.mp3`,
    duration: JSON.parse(readFileSync(join(outDir, `${l.id}.timing.json`), "utf8")).duration,
  }));
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2));
const total = index.reduce((s, x) => s + x.duration, 0);
console.log(`完成：${index.length}/${lines.length} 行，總長 ${total.toFixed(1)} 秒，索引在 ${join(config.output_dir, "index.json")}`);
