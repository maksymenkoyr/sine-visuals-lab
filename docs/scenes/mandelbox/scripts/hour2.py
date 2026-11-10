# Second look at the whole-loop frames (hour.py's frames.npy, 5 fps, 64x36):
# how fast the picture decorrelates (continuous morph vs shots), where single-frame
# jumps spike (cuts), and runs of left-right mirror symmetry (the kaleidoscope regime).
# usage: python hour2.py <hour_dir>
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

d = Path(sys.argv[1])
f = np.load(d / "frames.npy").astype(np.float32) / 255
n = len(f)
FPS = 5
lum = f @ np.array([0.2126, 0.7152, 0.0722], np.float32)
small = lum.reshape(n, 9, 4, 16, 4).mean(axis=(2, 4)).reshape(n, -1)
z = small - small.mean(1, keepdims=True)
z /= np.linalg.norm(z, axis=1, keepdims=True) + 1e-9
# structure correlation at lags
out = {}
for lag_s in (0.2, 0.4, 1, 2, 4, 8, 15, 30, 60):
    k = int(round(lag_s * FPS))
    c = (z[k:] * z[:-k]).sum(1)
    out[f"corr@{lag_s}s"] = [round(float(np.percentile(c, p)), 2) for p in (10, 50, 90)]
print("structure corr at lag (p10, median, p90):")
for k, v in out.items():
    print(f"  {k:>9}: {v}")

# single-frame jumps vs the local level
step = np.r_[0, 1 - (z[1:] * z[:-1]).sum(1)]
loc = ndimage.median_filter(step, size=25)
ratio = step / (loc + 1e-4)
spikes = np.flatnonzero((ratio > 6) & (step > 0.15))
print(f"\nframe step (1-corr) p50 {np.median(step):.4f} p90 {np.percentile(step, 90):.4f} p99 {np.percentile(step, 99):.4f} max {step.max():.3f}")
print(f"spikes (step > 6x local median and > 0.15): {len(spikes)}")
groups = []
for s in spikes:
    if groups and s - groups[-1][-1] <= 2:
        groups[-1].append(s)
    else:
        groups.append([s])
print("spike times (s):", [round(g[0] / FPS, 1) for g in groups][:80])

# mirror symmetry runs
mLR = (lum * lum[:, :, ::-1]).sum((1, 2))
a = lum - lum.mean((1, 2), keepdims=True)
b = a[:, :, ::-1]
mLR = (a * b).sum((1, 2)) / ((a * a).sum((1, 2)) + 1e-9)
c = a[:, ::-1, :]
mTB = (a * c).sum((1, 2)) / ((a * a).sum((1, 2)) + 1e-9)
sym = ndimage.median_filter((mLR > 0.9).astype(np.uint8), size=11)
runs = []
start = None
for i, v in enumerate(sym):
    if v and start is None:
        start = i
    if (not v or i == n - 1) and start is not None:
        if (i - start) / FPS >= 5:
            runs.append((round(start / FPS, 1), round((i - start) / FPS, 1), round(float(np.median(mTB[start:i])), 2)))
        start = None
print(f"\nLR-mirrored share of time: {sym.mean():.2f}; TB-mirrored share: {(ndimage.median_filter((mTB > 0.9).astype(np.uint8), size=11)).mean():.2f}")
print("mirrored runs >= 5 s (start s, length s, median TB corr):")
for r in runs:
    print("  ", r)

# colour: hue drift rate -- mean chroma angle per frame
rgb = f.reshape(n, -1, 3)
yiq_i = (0.596 * rgb[..., 0] - 0.274 * rgb[..., 1] - 0.322 * rgb[..., 2]).mean(1)
yiq_q = (0.211 * rgb[..., 0] - 0.523 * rgb[..., 1] + 0.312 * rgb[..., 2]).mean(1)
ang = np.unwrap(np.arctan2(yiq_q, yiq_i))
chroma = np.hypot(yiq_i, yiq_q)
print(f"\nmean-colour chroma p50 {np.median(chroma):.3f}; hue angle travelled over the loop: {abs(ang[-1] - ang[0]) / (2 * np.pi):.1f} turns, "
      f"total |d hue| {np.abs(np.diff(ang)).sum() / (2 * np.pi):.1f} turns")
# loop check: frames 3600 s apart
k = 3600 * FPS
if n > k + 10:
    c = (z[k:] * z[: n - k]).sum(1)
    best = max(range(-50, 51), key=lambda s: np.mean((z[k + max(0, s): n - max(0, -s)] * z[max(0, -s) + 0: n - k - max(0, s) + max(0,-s) - max(0,-s)][: len(z[k + max(0, s): n - max(0, -s)])]).sum(1)) if True else 0)
    print(f"loop check: structure corr between t and t+3600 s: median {np.median(c):.2f}")
