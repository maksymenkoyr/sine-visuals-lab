# Was a mirrored stretch made by a camera on a 3D mirror plane, or mirrored afterwards in 2D?
# By symmetry, a camera on a mirror plane sees no sideways motion on the plane: content can't cross the
# centre line, and just beside it moves sideways only as slowly as the zoom allows. A picture mirrored
# afterwards keeps the source's own sideways motion right up to the line, so content streams into or out
# of it. Dense optical flow (DIS) on every frame pair, then:
# - per row, the sideways speed 10-14 px beside the line over the frame's median speed (the main figure);
# - the row-averaged outward flow fitted as a + b*d over distance d from the line (a: the offset at the line).
# Calibrate on the same footage: zoomclip.py gives the floor (no crossing by construction), and the same
# window's unmirrored footage mirrored by ffmpeg (crop + hflip + hstack) gives the 2D level.
# Also scans every vertical axis for mirror correlation (a single 3D plane gives only the centre).
# usage: seamflow.py <video> <t0> <dur> <fps> [width]
import sys

import cv2
import numpy as np

from vidio import load

src, t0, dur, fps = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
width = int(sys.argv[5]) if len(sys.argv) > 5 else 640
f = load(src, t0, dur, fps, width)
n, H, W = f.shape

small = f[:, ::2, ::2].astype(np.float32)
sw = small.shape[2]
axes = np.arange(int(sw * 0.1), int(sw * 0.9))
scores = []
for c in axes:
    k = min(c, sw - c) - 1
    a = small[:, :, c - k:c][:, :, ::-1]
    b = small[:, :, c:c + k]
    a = a - a.mean((1, 2), keepdims=True)
    b = b - b.mean((1, 2), keepdims=True)
    scores.append(np.median((a * b).sum((1, 2)) / np.sqrt((a * a).sum((1, 2)) * (b * b).sum((1, 2)) + 1e-9)))
scores = np.array(scores)
peaks = []
for i in np.argsort(scores)[::-1]:
    if all(abs(axes[i] - axes[j]) > sw * 0.04 for j in peaks):
        peaks.append(i)
    if len(peaks) == 4:
        break
print(f"{t0}+{dur}s at {fps:g} fps, {W}x{H}, {n} frames")
print("mirror axis scan, best 4 (share of the width: median corr):", ", ".join(f"{axes[i] / sw:.3f}: {scores[i]:+.2f}" for i in peaks))

dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
c = W / 2 - 0.5
ci = int(round(c + 0.5))
ds = np.arange(4, 121, 4)
cols_left = np.round(c - ds).astype(int)
cols_right = np.round(c + ds).astype(int)
fit_a, fit_b, ratio = [], [], []
for i in range(n - 1):
    fl = dis.calc(f[i], f[i + 1], None)
    u = fl[..., 0]
    near = np.abs(np.concatenate([u[:, ci - 14:ci - 10], u[:, ci + 10:ci + 14]], 1)).mean(1)
    ratio.append(np.median(near) / (np.median(np.hypot(fl[..., 0], fl[..., 1])) + 1e-6))
    outward = (-u[:, cols_left].mean(0) + u[:, cols_right].mean(0)) / 2
    m = ds >= 8
    b, a = np.polyfit(ds[m], outward[m], 1)
    fit_a.append(a)
    fit_b.append(b)
ratio, fit_a = np.array(ratio), np.array(fit_a)
print(f"per row: sideways speed 10-14 px beside the line / the frame's median speed: median {np.median(ratio):.3f} "
      f"(p25 {np.percentile(ratio, 25):.3f}, p75 {np.percentile(ratio, 75):.3f})")
print(f"row-averaged outward flow = a + b*d: |a| median {np.median(np.abs(fit_a)):.3f} px/frame (p90 {np.percentile(np.abs(fit_a), 90):.3f}); "
      f"b median {np.median(fit_b):+.4f} per frame")
