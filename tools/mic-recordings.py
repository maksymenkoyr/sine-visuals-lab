#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["imageio-ffmpeg>=0.5"]
# ///
"""
Turns phone videos of a real party (music through speakers, heard by a mic
in a loud room) into the tempo eval's recordings set: mono 16-bit 48 kHz
audio at tools/.cache/mic-recordings/<slug>/audio.wav in the main checkout
(next to the tempo-tracks set, so every worktree sees it), plus a meta.json
whose `bpm` is the true tempo, filled in by hand once someone knows it
(the song's published tempo, or tapped by ear). tests/tempoRecordings.test.ts
scores every recording that has one, next to the tempo-tracks set.

The recordings stay in the gitignored cache and never enter the repo: they
are private videos of copyrighted music. meta.json keeps only the video's
file name, never its path.

ffmpeg comes from the imageio-ffmpeg package because this machine's
Homebrew ffmpeg is broken.

    uv run tools/mic-recordings.py <video> [<video> ...] [--name slug] [--bpm N]
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

SR = 48000


def main_checkout() -> Path:
    # The main checkout, not this worktree: the cache outlives worktrees.
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=Path(__file__).resolve().parent, check=True, capture_output=True, text=True,
    ).stdout.strip()
    return Path(common).parent


CACHE = main_checkout() / "tools" / ".cache" / "mic-recordings"


def slug_for(video: Path) -> str:
    return re.sub(r"[^a-z0-9]+", "-", video.stem.lower()).strip("-")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("videos", nargs="+", type=Path)
    ap.add_argument("--name", help="slug for a single video (default: from its file name)")
    ap.add_argument("--bpm", type=float, help="true tempo, if known (a single video)")
    args = ap.parse_args()
    if len(args.videos) > 1 and (args.name or args.bpm):
        ap.error("--name and --bpm take a single video")
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for video in args.videos:
        slug = args.name or slug_for(video)
        out = CACHE / slug
        out.mkdir(parents=True, exist_ok=True)
        wav = out / "audio.wav"
        subprocess.run(
            [ffmpeg, "-y", "-v", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", "-map_metadata", "-1", str(wav)],
            check=True,
        )
        meta_path = out / "meta.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        meta.update({"slug": slug, "source": video.name, "dur": round((wav.stat().st_size - 44) / 2 / SR, 2)})
        if args.bpm:
            meta["bpm"] = args.bpm
        meta.setdefault("bpm", None)
        meta_path.write_text(json.dumps(meta, indent=1) + "\n")
        print(f"{slug}: {meta['dur']} s, bpm {meta['bpm']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
