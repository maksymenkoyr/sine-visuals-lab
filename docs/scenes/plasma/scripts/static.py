# The time-mean of a long clip: a part of the picture that never moves shows
# up as structure in the mean, and its share of the per-frame variance is the
# floor the frame correlation never drops below. static.py <ffmpeg> <video> <out.png> [fps]
import subprocess
import sys

import numpy as np
from PIL import Image

ff, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
fps = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
W, H = 128, 72
raw = subprocess.run([ff, "-v", "error", "-i", src, "-vf", f"fps={fps},scale={W}:{H}:flags=area", "-pix_fmt", "rgb24",
                      "-f", "rawvideo", "-"], capture_output=True).stdout
n = len(raw) // (W * H * 3)
F = np.frombuffer(raw[: n * W * H * 3], np.uint8).reshape(n, H, W, 3).astype(np.float32) / 255
V = F.max(-1)
mean = V.mean(0)
dev = V - mean
print(f"{n} frames; time-mean V {mean.mean():.3f}, spatial sd of the time-mean {mean.std():.4f}, "
      f"mean per-frame sd {V.std((1, 2)).mean():.4f}")
print(f"static share of variance: {mean.var() / (V.var((1, 2)).mean()):.3f}")
rows = [mean[:, i * W // 8:(i + 1) * W // 8].mean() for i in range(8)]
cols = [mean[j * H // 6:(j + 1) * H // 6, :].mean() for j in range(6)]
print("time-mean V by column (left to right):", np.round(rows, 3))
print("time-mean V by row (top to bottom):  ", np.round(cols, 3))
lo, hi = np.percentile(mean, [1, 99])
img = np.clip((mean - lo) / (hi - lo + 1e-6), 0, 1)
Image.fromarray((img * 255).astype(np.uint8)).resize((W * 4, H * 4), Image.BICUBIC).save(out)
print("wrote", out, f"(stretched {lo:.3f}..{hi:.3f})")
