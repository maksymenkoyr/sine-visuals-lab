#!/bin/zsh
# Grab one frame at each given second of a YouTube video without downloading it.
# usage: survey.sh <url> <format> <outdir> <t1> [t2 ...]
set -e
url=$1; fmt=$2; out=$3; shift 3
mkdir -p "$out"
U=$(uvx yt-dlp --js-runtimes node -f "$fmt" -g "$url" 2>/dev/null)
print -r -- "$U" > "$out/.src-url"
n=0
for t in "$@"; do
  ffmpeg -hide_banner -loglevel error -y -ss "$t" -i "$U" -frames:v 1 -q:v 3 "$out/s_$(printf %05d $t).jpg" &
  n=$((n + 1))
  (( n % 10 == 0 )) && wait
done
wait
ls "$out" | wc -l
