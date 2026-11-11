# How a mirrored run starts and ends: per frame, the left-right mirror correlation about the frame's centre,
# and how much each half changed since the previous frame. A mirror switched on afterwards over a continuous
# clip jumps in one frame with one half unchanged; the reference's runs instead ramp over 0.5-2 s while
# both halves move (they are dissolves between clips, see blendfit.py).
# usage: mirrorswitch.py <video> <fps> <width> <t0,dur> [<t0,dur> ...]
import sys

import numpy as np

from vidio import load

src, fps, width = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])


def corr(a, b):
    a = a - a.mean(axis=(-2, -1), keepdims=True)
    b = b - b.mean(axis=(-2, -1), keepdims=True)
    return (a * b).sum(axis=(-2, -1)) / (np.sqrt((a * a).sum(axis=(-2, -1)) * (b * b).sum(axis=(-2, -1))) + 1e-9)


for spec in sys.argv[4:]:
    t0, dur = map(float, spec.split(","))
    f = load(src, t0, dur, fps, width).astype(np.float32) / 255
    n, h, w = f.shape
    half = w // 2
    lr = corr(f, f[:, :, ::-1])
    left, right = f[:, :, :half], f[:, :, half:]
    d_left = np.r_[np.nan, 1 - corr(left[1:], left[:-1])]
    d_right = np.r_[np.nan, 1 - corr(right[1:], right[:-1])]
    d_whole = np.r_[np.nan, 1 - corr(f[1:], f[:-1])]
    d_lr = np.r_[0, np.abs(np.diff(lr))]
    print(f"\n== {t0:.1f}+{dur:.0f}s at {fps:g} fps, {w}x{h}: LR corr p10/50/90 "
          f"{np.percentile(lr, 10):.2f}/{np.median(lr):.2f}/{np.percentile(lr, 90):.2f}; whole-frame step median {np.nanmedian(d_whole):.3f}")
    for i in sorted(np.argsort(d_lr)[::-1][:4]):
        print(f"  biggest LR change at t={t0 + i / fps:8.2f}s: LR {lr[max(i - 1, 0)]:.2f} -> {lr[i]:.2f}")
        for j in range(max(i - 3, 1), min(i + 4, n)):
            print(f"    t={t0 + j / fps:8.2f}  LR {lr[j]:+.3f}  step whole {d_whole[j]:.3f}  left {d_left[j]:.3f}  right {d_right[j]:.3f}")
