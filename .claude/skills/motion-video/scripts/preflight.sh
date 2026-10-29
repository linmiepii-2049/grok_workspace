#!/usr/bin/env bash
# 檢查 motion-video 需要的環境，只輸出一行結果；有問題時逐項列出修正方式
# 用法：scripts/preflight.sh
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
problems=()
notes=()

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if (( node_major < 22 )); then problems+=("Node 需要 22 以上（目前 ${node_major}）"); fi

for bin in ffmpeg ffprobe; do
  command -v "$bin" >/dev/null || problems+=("缺少 $bin：Mac 用 brew install ffmpeg，雲端由 SessionStart hook 安裝")
done

# CLI 要用 repo 裡鎖定的版本，npx 才不會每次抓最新版
if [[ -x "$root/node_modules/.bin/hyperframes" ]]; then
  hf_version="$(node -p "require('$root/node_modules/hyperframes/package.json').version" 2>/dev/null || echo '?')"
  notes+=("hyperframes $hf_version")
else
  problems+=("找不到鎖定版本的 hyperframes CLI：在 repo 根目錄執行 npm ci")
fi

[[ "${HYPERFRAMES_NO_TELEMETRY:-}" == "1" ]] || problems+=("HYPERFRAMES_NO_TELEMETRY 不是 1：JT-Projects 的 .claude/settings.json 應該設定它")

# 旁白密鑰：本機看環境變數或鑰匙圈；雲端不持有密鑰，改走 GitHub Actions
for pair in "MiniMax:MINIMAX_API_KEY" "ElevenLabs:ELEVENLABS_API_KEY"; do
  label="${pair%%:*}"
  var="${pair##*:}"
  if [[ -n "${!var:-}" ]]; then
    notes+=("$label 密鑰：環境變數")
  elif [[ "$(uname)" == "Darwin" ]] && security find-generic-password -s "$var" >/dev/null 2>&1; then
    notes+=("$label 密鑰：鑰匙圈")
  else
    notes+=("$label 密鑰：無，改由 GitHub Actions 的 tts workflow 產生")
  fi
done

if (( ${#problems[@]} )); then
  echo "❌ preflight：${#problems[@]} 個問題"
  printf '  - %s\n' "${problems[@]}"
  exit 1
fi
# IFS 只取第一個位元組，全形逗號會變亂碼，所以用 printf 串接
joined="$(printf '%s，' "${notes[@]}")"
echo "✅ preflight：${joined%，}"
