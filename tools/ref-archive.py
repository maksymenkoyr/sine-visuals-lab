#!/usr/bin/env python3
"""
ref-archive: keep every /ref bundle — the reference media and our comparison
shots — in the PRIVATE repo maksymenkoyr/sine-visuals-lab-refs, so a scene can
be picked up again long after the machine that measured it is gone.

    python3 tools/ref-archive.py <bundle> [<bundle> ...] [--from DIR]
    python3 tools/ref-archive.py --all [--from DIR]

Why a separate private repo: a bundle holds third-party media — the downloaded
video, its frames, audio and contact sheets. Putting those in this public repo
would be redistributing someone else's work, which is the one thing that must
never happen. The scene's public record (docs/scenes/<id>.md) holds the links,
timestamps and measurements, and names the bundle; the archive holds the
media. Never make the archive repo public.

What it does, per bundle: copies `<cache>/<bundle>/` into
`<archive>/<bundle>/` (plus the bundle's source video from `_downloads/`, if
one is named after it), then commits and pushes that bundle on its own, so an
interrupted run resumes cleanly. `--all` archives every bundle in the cache,
including all of `_downloads/`. Re-running is cheap: unchanged files are
skipped and a bundle with nothing new makes no commit.

Files over LIMIT_MB aren't committed — GitHub rejects files over 100 MB and
warns from 50. They're listed in `<archive>/NOT-ARCHIVED.md` with their size
and, for a downloaded video, how to fetch it again; the local copy stays
where it is.

Where things are:
  cache     tools/.cache/refs/ of this checkout, or --from DIR. A bundle made
            in a worktree lives in that worktree's cache — pass its path.
  archive   $SINE_REFS_ARCHIVE, default ~/projects/sine-visuals-lab-refs — a
            clone of the private repo, cloned on first use from
            $SINE_REFS_REMOTE (default the SSH URL below).
"""
from __future__ import annotations

import argparse
import filecmp
import os
import shutil
import subprocess
import sys
from pathlib import Path

LIMIT_MB = 50
DEFAULT_REMOTE = "git@github.com:maksymenkoyr/sine-visuals-lab-refs.git"
HERE = Path(__file__).resolve().parent
DEFAULT_CACHE = HERE / ".cache" / "refs"
DOWNLOADS = "_downloads"
SKIPPED_LOG = "NOT-ARCHIVED.md"


def git(archive: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(archive), *args], check=check, text=True, capture_output=True)


def ensure_archive(archive: Path, remote: str) -> None:
    if not (archive / ".git").exists():
        print(f"cloning {remote} into {archive}")
        archive.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", remote, str(archive)], check=True)
    pulled = git(archive, "pull", "--ff-only", check=False)
    if pulled.returncode != 0:
        sys.exit(f"archive clone isn't fast-forwardable; fix it by hand first:\n{pulled.stderr}")


def redownload_hint(rel: Path) -> str:
    # Downloads are named after the YouTube id (tools/ref-scan.py), and a
    # watch URL resolves shorts too.
    if rel.parts[0] == DOWNLOADS:
        return f"`uvx yt-dlp -o '%(id)s.%(ext)s' https://www.youtube.com/watch?v={rel.stem}`"
    return "regenerate from the source video with tools/ref-scan.py"


def copy_tree(src: Path, dst: Path, rel_root: Path, skipped: list[tuple[Path, int]]) -> int:
    """Copy src into dst, skipping oversized files; return files written."""
    written = 0
    for path in sorted(src.rglob("*")):
        if path.is_dir() or path.is_symlink():
            continue
        rel = path.relative_to(rel_root)
        size = path.stat().st_size
        if size > LIMIT_MB * 1024 * 1024:
            skipped.append((rel, size))
            continue
        target = dst / path.relative_to(src)
        if target.exists() and filecmp.cmp(path, target, shallow=False):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        written += 1
    return written


def record_skipped(archive: Path, skipped: list[tuple[Path, int]]) -> None:
    log = archive / SKIPPED_LOG
    header = (
        "# Not archived\n\n"
        f"Files over {LIMIT_MB} MB stay on the machine that made them (GitHub "
        "rejects large files). Each line says how to get it back.\n\n"
    )
    lines = [line for line in log.read_text().splitlines() if line.startswith("- `")] if log.exists() else []
    known = {line.split("`")[1] for line in lines}
    for rel, size in skipped:
        if str(rel) not in known:
            lines.append(f"- `{rel}` — {size / 1048576:.0f} MB — {redownload_hint(rel)}")
            known.add(str(rel))
    log.write_text(header + "\n".join(sorted(lines)) + "\n")


def archive_one(name: str, cache: Path, archive: Path) -> None:
    src = cache / name
    if not src.is_dir():
        print(f"skip {name}: no such bundle in {cache}")
        return
    skipped: list[tuple[Path, int]] = []
    written = copy_tree(src, archive / name, cache, skipped)
    if name != DOWNLOADS:
        for video in sorted((cache / DOWNLOADS).glob(f"{name}.*")):
            written += copy_tree_file(video, archive / DOWNLOADS / video.name, cache, skipped)
    if skipped:
        record_skipped(archive, skipped)
    # git add fails outright on a pathspec that matches nothing, so name only
    # the paths that exist.
    paths = [p for p in (name, DOWNLOADS, SKIPPED_LOG) if (archive / p).exists()]
    git(archive, "add", "-A", "--", *paths)
    if git(archive, "diff", "--cached", "--quiet", check=False).returncode == 0:
        print(f"{name}: nothing new")
        return
    git(archive, "commit", "-m", f"Archive {name}")
    pushed = git(archive, "push", check=False)
    if pushed.returncode != 0:
        sys.exit(f"{name}: committed but push failed — re-run to retry:\n{pushed.stderr}")
    note = f", {len(skipped)} over {LIMIT_MB} MB listed in {SKIPPED_LOG}" if skipped else ""
    print(f"{name}: archived {written} file(s){note}")


def copy_tree_file(path: Path, target: Path, rel_root: Path, skipped: list[tuple[Path, int]]) -> int:
    size = path.stat().st_size
    if size > LIMIT_MB * 1024 * 1024:
        skipped.append((path.relative_to(rel_root), size))
        return 0
    if target.exists() and filecmp.cmp(path, target, shallow=False):
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    return 1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("bundles", nargs="*", help="bundle names under the cache")
    ap.add_argument("--all", action="store_true", help="every bundle in the cache, and all downloads")
    ap.add_argument("--from", dest="cache", default=str(DEFAULT_CACHE), help="the refs cache to read (default: this checkout's)")
    args = ap.parse_args()

    cache = Path(args.cache).expanduser().resolve()
    archive = Path(os.environ.get("SINE_REFS_ARCHIVE", "~/projects/sine-visuals-lab-refs")).expanduser()
    remote = os.environ.get("SINE_REFS_REMOTE", DEFAULT_REMOTE)
    names = sorted(p.name for p in cache.iterdir() if p.is_dir()) if args.all else args.bundles
    if not names:
        ap.error("name at least one bundle, or pass --all")

    ensure_archive(archive, remote)
    for name in names:
        archive_one(name, cache, archive)


if __name__ == "__main__":
    main()
