# Motion without geometry: the mean correlation of a frame with itself LAGS seconds later
# (160x90 grey, mean removed), from a video or from a folder of equally spaced frames.
#   uv run --with numpy --with pillow python lagcorr.py video <file> <ffmpeg> <start s> <dur s>
#   uv run --with numpy --with pillow python lagcorr.py frames <dir> <every ms>
# A recording from rest.mjs --video is real time; screenshots stall the app's clock, so use video.
import glob
import subprocess
import sys

import numpy as np
from PIL import Image

LAGS = [0.25, 0.5, 1, 2, 4, 8]
FPS = 4


def norm(a):
    a = a.astype(np.float32).ravel()
    a = a - a.mean()
    return a / (np.linalg.norm(a) + 1e-9)


if sys.argv[1] == "video":
    path, ffmpeg, start, dur = sys.argv[2:6]
    raw = subprocess.run([ffmpeg, "-v", "error", "-ss", start, "-t", dur, "-i", path, "-vf",
                          f"fps={FPS},scale=160:90", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         capture_output=True).stdout
    frames = [norm(f) for f in np.frombuffer(raw, np.uint8).reshape(-1, 90, 160)]
    step = 1 / FPS
else:
    files = sorted(glob.glob(sys.argv[2] + "/*.png")) + sorted(glob.glob(sys.argv[2] + "/*.jpg"))
    frames = [norm(np.asarray(Image.open(p).convert("L").resize((160, 90), Image.BILINEAR))) for p in files]
    step = float(sys.argv[3]) / 1000
row = []
for lag in LAGS:
    k = round(lag / step)
    if k < 1 or k >= len(frames):
        row.append(f"{lag}s -")
        continue
    row.append(f"{lag}s {np.mean([float(frames[i] @ frames[i + k]) for i in range(len(frames) - k)]):.2f}")
print(f"n={len(frames)} " + " | ".join(row))
