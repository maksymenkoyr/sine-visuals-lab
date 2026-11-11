# Shared video reading for the #830 scripts beside this one: decode a window of a video (ffmpeg and ffprobe
# on PATH) to grey or RGB frames at a chosen rate and width, as one array or frame by frame.
import subprocess

import numpy as np


def size(src):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", src], capture_output=True, text=True, check=True).stdout
    w, h = map(int, out.strip().split(","))
    return w, h


def _cmd(src, t0, dur, fps, w, h, gray):
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(t0), "-t", str(dur), "-i", src,
            "-vf", f"fps={fps},scale={w}:{h}:flags=area", "-pix_fmt", "gray" if gray else "rgb24", "-f", "rawvideo", "-"]


def dims(src, width):
    w0, h0 = size(src)
    return width, round(width * h0 / w0 / 2) * 2


def load(src, t0, dur, fps, width, gray=True):
    w, h = dims(src, width)
    raw = subprocess.run(_cmd(src, t0, dur, fps, w, h, gray), capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8)
    return f.reshape(-1, h, w) if gray else f.reshape(-1, h, w, 3)


def frames(src, t0, dur, fps, width, gray=True):
    """Yields frames one at a time, for windows too long to hold."""
    w, h = dims(src, width)
    n = w * h * (1 if gray else 3)
    p = subprocess.Popen(_cmd(src, t0, dur, fps, w, h, gray), stdout=subprocess.PIPE)
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        f = np.frombuffer(buf, np.uint8)
        yield f.reshape(h, w) if gray else f.reshape(h, w, 3)
    p.wait()
