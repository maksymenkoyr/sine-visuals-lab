#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10.1"]
# ///
"""
ref-keep: save *our* half of a /ref bundle into the scene's folder in this
repo, so the measurements a scene was built against survive the local cache.

    uv run tools/ref-keep.py <bundle> <scene-id> [--from DIR] [--as NAME]

Copies `<cache>/<bundle>/` into `docs/scenes/<scene-id>/<NAME or bundle>/`,
keeping only what we produced:
  - the report and the measurement data (report.md, *.json, *.tsv)
  - our own shots of the scene (ours-<scene>/, converted to JPEG)
  - any script that sat in the bundle

and leaving out everything that is the reference's own material, because this
repo is public and that material is someone else's work:
  - the video, audio, frames, bursts and sheets
  - images built from the reference's pixels (keyframes, look, slit-scan,
    timeline, and compare/cmp-* sheets that put its frames beside ours)
  - a pasted reference still (reference.*)
  - the uploader's metadata (*.info.json — title, description)

Absolute paths inside the copied text (where the source video sat on the
measuring machine) are rewritten repo-relative. Re-running replaces the saved
copy. The reference media itself belongs in the private archive
(tools/ref-archive.py), never here. CLAUDE.md's standing rule on scene records
says where each kind of material goes.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = REPO / "tools" / ".cache" / "refs"

THEIRS_DIRS = {"frames", "bursts", "sheets"}
THEIRS_FILES = {"keyframes.png", "look.png", "slitscan.png", "timeline.png", "audio.wav",
                "compare.png", "compare.html"}
THEIRS_SUFFIXES = (".info.json", ".wav", ".mp4", ".webm", ".mkv", ".m4a", ".jpg", ".jpeg")
TEXT_SUFFIXES = {".md", ".json", ".tsv", ".py", ".mjs", ".js", ".html", ".txt"}
# Anything up to a repo-relative anchor, e.g. /home/x/repo/tools/.cache/... -> tools/.cache/...
ABS_TO_REPO = re.compile(r"/(?:[^\s\"'`<>()]+/)*?((?:tools/\.cache|node_modules|src|docs|tools)/)")


def is_ours(rel: Path) -> bool:
    if any(part in THEIRS_DIRS for part in rel.parts):
        return False
    if rel.name in THEIRS_FILES or rel.name.endswith(THEIRS_SUFFIXES):
        return False
    # A pasted reference still, and any comparison image (theirs beside ours).
    if rel.name.startswith(("reference", "compare", "cmp-")):
        return False
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("bundle")
    ap.add_argument("scene")
    ap.add_argument("--from", dest="cache", default=str(DEFAULT_CACHE), help="refs cache (default: this checkout's)")
    ap.add_argument("--as", dest="name", help="folder name under the scene (default: the bundle name)")
    args = ap.parse_args()

    src = Path(args.cache).expanduser().resolve() / args.bundle
    if not src.is_dir():
        sys.exit(f"no bundle at {src}")
    dest = REPO / "docs" / "scenes" / args.scene / (args.name or args.bundle)
    if dest.exists():
        shutil.rmtree(dest)

    kept = skipped = 0
    warnings = []
    for path in sorted(p for p in src.rglob("*") if p.is_file() and not p.is_symlink()):
        rel = path.relative_to(src)
        if not is_ours(rel):
            skipped += 1
            continue
        if path.suffix == ".png":
            out = dest / rel.with_suffix(".jpg")
            out.parent.mkdir(parents=True, exist_ok=True)
            Image.open(path).convert("RGB").save(out, "JPEG", quality=82, optimize=True)
        else:
            out = dest / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            if path.suffix in TEXT_SUFFIXES:
                text = ABS_TO_REPO.sub(r"\1", path.read_text(encoding="utf-8", errors="replace"))
                if "/Users/" in text or "/home/" in text:
                    warnings.append(str(rel))
                out.write_text(text, encoding="utf-8")
            else:
                shutil.copy2(path, out)
        kept += 1

    size = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file()) / 1048576 if dest.exists() else 0
    print(f"kept {kept} file(s), {size:.1f} MB -> {dest.relative_to(REPO)} (left out {skipped} of the reference's own)")
    for w in warnings:
        print(f"  check for a leftover local path: {w}")
    print("Name this folder in the scene's record, under Materials.")


if __name__ == "__main__":
    main()
