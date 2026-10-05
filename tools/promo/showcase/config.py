"""Shared by the showcase scripts: loads the config and resolves its paths.

Not run on its own. Every script takes the config path as its first argument (a copy of
showcase.example.json with the real values, normally <work>/showcase.json). The work dir is the
config's "work" (absolute, or relative to the repo root; default tools/.cache/showcase, which is
gitignored); every other relative path in the config is relative to the work dir. Everything the
scripts write (intro, gallery and camera clips, caption PNGs, the finished videos) lands in the work
dir, never in the repo.
"""
import json, os

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))


def load(path):
    cfg = json.load(open(path))
    work = cfg.get("work", "tools/.cache/showcase")
    cfg["_work"] = work if os.path.isabs(work) else os.path.join(REPO, work)
    return cfg


def p(cfg, rel):
    """A config path: absolute stays, relative is under the work dir."""
    return rel if os.path.isabs(rel) else os.path.join(cfg["_work"], rel)


def pick(v, fmt):
    """A value that may differ per format: {"h": .., "v": ..} or the same for both."""
    return v[fmt] if isinstance(v, dict) and "h" in v and "v" in v else v


def size(fmt):
    return (1080, 1920) if fmt == "v" else (1920, 1080)
