#!/usr/bin/env bash
# 渲染專案所有比例的正式版到 outputs/video/，長片逐章渲染再接合，最後用 ffprobe 驗證
# 用法：scripts/render-all.sh projects/<專案> [--fps 30]
set -euo pipefail

project="${1:-}"
fps=30
[[ "${2:-}" == "--fps" ]] && fps="${3:-30}"
if [[ -z "$project" || ! -d "$project/video" ]]; then
  echo "用法：scripts/render-all.sh projects/<專案>（底下要有 video/<aspect>/index.html）" >&2
  exit 2
fi
export HYPERFRAMES_NO_TELEMETRY=1
slug="$(basename "$project" | sed -E 's/^[0-9]{4}-[0-9]{2}-//')"
outdir="$project/outputs/video"
mkdir -p "$outdir"

expected_size() {
  case "$1" in
    9x16) echo "1080x1920" ;; 16x9) echo "1920x1080" ;; 4x5) echo "1080x1350" ;; 1x1) echo "1080x1080" ;; *) echo "" ;;
  esac
}
duration_of() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
fmt_time() { awk -v s="$1" 'BEGIN { printf "%d:%02d", int(s / 60), int(s % 60) }'; }

summary=()
for index in "$project"/video/*/index.html; do
  [[ -f "$index" ]] || continue
  dir="$(dirname "$index")"
  aspect="$(basename "$dir")"
  final="$outdir/$slug-$aspect.mp4"
  chapters=("$dir"/compositions/ch*.html)

  if [[ -f "${chapters[0]}" ]]; then
    # 長片：只重新渲染原始檔比上次輸出新的章節
    mkdir -p "$dir/.render"
    : >"$dir/.render/list.txt"
    : >"$outdir/$slug-$aspect-chapters.txt"
    offset=0
    for ch in "${chapters[@]}"; do
      name="$(basename "$ch" .html)"
      part="$dir/.render/$name.mp4"
      if [[ ! -f "$part" || "$ch" -nt "$part" ]]; then
        echo "▶ $aspect/$name"
        (cd "$dir" && npx hyperframes render -c "compositions/$name.html" -o ".render/$name.mp4" --fps "$fps" --quality delivery)
      fi
      echo "file '$name.mp4'" >>"$dir/.render/list.txt"
      echo "$(fmt_time "$offset") ${name#ch[0-9][0-9]-}" >>"$outdir/$slug-$aspect-chapters.txt"
      offset="$(awk -v a="$offset" -v b="$(duration_of "$part")" 'BEGIN { print a + b }')"
    done
    # 所有章節用同樣的 fps 與品質設定，可以直接接合不重新編碼
    ffmpeg -v error -y -f concat -safe 0 -i "$dir/.render/list.txt" -c copy "$final"
  else
    echo "▶ $aspect"
    npx hyperframes render "$dir" -o "$final" --fps "$fps" --quality delivery
  fi

  # 響度正規化到 -14 LUFS、峰值 -1 dBTP（YouTube、IG、TikTok 的常見目標，見 references/audio.md）
  # 兩段式 loudnorm：先量測再套用，比單段式準；影像直接複製不重新編碼
  if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$final" | grep -q .; then
    stats="$(ffmpeg -nostats -i "$final" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')"
    get() { echo "$stats" | sed -nE "s/.*\"$1\" : \"([^\"]+)\".*/\1/p"; }
    ln="loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true"
    ffmpeg -v error -y -i "$final" -c:v copy -af "$ln" -ar 48000 -c:a aac -b:a 192k "$final.norm.mp4" && mv "$final.norm.mp4" "$final"
  fi

  size="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$final")"
  want="$(expected_size "$aspect")"
  dur="$(duration_of "$final")"
  lufs="$(ffmpeg -nostats -i "$final" -af ebur128 -f null - 2>&1 | awk '/I:/ { v = $2 } END { print v }')"
  mark="✅"
  [[ -n "$want" && "$size" != "$want" ]] && mark="❌ 尺寸應為 $want"
  summary+=("$mark $final（$(fmt_time "$dur")，$size，${lufs:-無音軌} LUFS）")
done

if (( ${#summary[@]} == 0 )); then
  echo "找不到 $project/video/*/index.html" >&2
  exit 1
fi
printf '%s\n' "${summary[@]}"
