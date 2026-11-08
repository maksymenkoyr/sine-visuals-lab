#!/bin/zsh
# Cut a frame-accurate window of a long YouTube reference, with its own audio, for tools/ref-scan.py.
# A YouTube DASH stream read straight by ffmpeg is throttled to tens of KB/s; an HLS format seeks by
# segment instead (a 10 s 720p60 cut took 2 s), so: get the HLS URL with
# `uvx yt-dlp --js-runtimes node -f 311 -g <url> > hls.url`, download the audio alone with yt-dlp's
# own (chunked, fast) downloader, then cut both here at the same start.
# usage: cutwin.sh <hls.url file> <audio file> <start_s> <dur_s> <out.mp4>
set -e
ffmpeg -hide_banner -loglevel error -y \
  -ss "$3" -t "$4" -i "$(cat "$1")" \
  -ss "$3" -t "$4" -i "$2" \
  -map 0:v -map 1:a -c:v libx264 -crf 14 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k "$5"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$5"
