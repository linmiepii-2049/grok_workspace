#!/usr/bin/env bash
# 跑 HyperFrames 的 lint 與 check，整理成一行 PASS/FAIL 加問題清單，原始 JSON 存在 <dir>/.qa/
# 用法：scripts/qa.sh <aspect 專案資料夾> [--lint-only]
#   資料夾名稱（9x16、16x9、4x5、1x1）決定字幕安全區，見 references/aspects.md
set -uo pipefail

dir="${1:-}"
mode="${2:-}"
if [[ -z "$dir" || ! -f "$dir/index.html" ]]; then
  echo "用法：scripts/qa.sh <含 index.html 的 aspect 專案資料夾> [--lint-only]" >&2
  exit 2
fi
export HYPERFRAMES_NO_TELEMETRY=1
out="$dir/.qa"
mkdir -p "$out"

# 安全區取三個平台中最保守的下方範圍；右側與上方由 L2 目視檢查
case "$(basename "$dir")" in
  9x16) zone="x0=0;y0=.80;x1=1;y1=1;severity=error;seek=.25,.5,.75" ;;
  16x9) zone="x0=0;y0=.90;x1=1;y1=1;severity=error;seek=.25,.5,.75" ;;
  4x5 | 1x1) zone="x0=0;y0=.92;x1=1;y1=1;severity=error;seek=.25,.5,.75" ;;
  *) zone="" ;;
esac

npx hyperframes lint "$dir" --json >"$out/lint.json" 2>"$out/lint.err"
if [[ "$mode" != "--lint-only" ]]; then
  args=(check "$dir" --json)
  [[ -n "$zone" ]] && args+=(--caption-zone "$zone")
  npx hyperframes "${args[@]}" >"$out/check.json" 2>"$out/check.err"
fi

# 從 JSON 裡找出所有帶 severity 的 finding，不依賴固定結構，CLI 改版也能讀
node - "$out" "$mode" <<'JS'
const fs = require("node:fs");
const [out, mode] = process.argv.slice(2);
const files = mode === "--lint-only" ? ["lint"] : ["lint", "check"];
const findings = [];
let parseFailed = [];
const walk = (v, src) => {
  if (Array.isArray(v)) return v.forEach((x) => walk(x, src));
  if (v && typeof v === "object") {
    if (typeof v.severity === "string" && (v.message || v.code)) findings.push({ ...v, src });
    else Object.values(v).forEach((x) => walk(x, src));
  }
};
for (const f of files) {
  const raw = fs.readFileSync(`${out}/${f}.json`, "utf8").trim();
  if (!raw) { parseFailed.push(f); continue; }
  try { walk(JSON.parse(raw), f); } catch { parseFailed.push(f); }
}
const isErr = (s) => /^(error|fatal)$/i.test(s);
const isWarn = (s) => /^warn/i.test(s);
// lint 和 check 會回報同一個問題，用 code + message 去重
const seen = new Set();
const unique = findings.filter((x) => {
  const k = `${x.code}|${x.message}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
const errors = unique.filter((x) => isErr(x.severity));
const warns = unique.filter((x) => isWarn(x.severity));
if (parseFailed.length) {
  console.log(`❌ QA 無法讀取 ${parseFailed.join("、")} 的輸出，看 ${out}/*.err`);
  process.exit(1);
}
const status = errors.length ? "❌ FAIL" : "✅ PASS";
console.log(`${status}（${files.join("+")}）：${errors.length} error、${warns.length} warning`);
const line = (x) => {
  const where = x.file || x.source || x.composition || x.selector || "";
  const t = x.time ?? x.t ?? x.sampleTime;
  const fix = x.fix ? ` → ${x.fix}` : "";
  return `  - [${x.severity}] ${x.code || ""} ${where}${t != null ? ` t=${t}s` : ""}：${x.message || ""}${fix}`;
};
// 只印前 15 條，完整內容在 JSON 裡
[...errors, ...warns].slice(0, 15).forEach((x) => console.log(line(x)));
if (errors.length + warns.length > 15) console.log(`  …其餘見 ${out}/`);
process.exit(errors.length ? 1 : 0);
JS
