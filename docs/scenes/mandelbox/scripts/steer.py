# Does a picture's view turn while it flies? Per frame pair, dense optical flow (DIS) fitted robustly (the
# worst 30% dropped, three rounds) with a similarity motion: u = a + z*x - r*y, v = b + z*y + r*x, x and y
# from the frame centre in half-heights, up positive. a, b = sideways and up-down shift (a turning camera
# pans or tilts the whole view), z = zoom (flying in), r = roll; all per second. Parallax from walls near
# the camera also reads as shift: our own straight push-in reads about 0.05 half-heights/s, so only a
# one-way drift that adds up over minutes is a turn. Its zoom reads about 2x tools/ref-scan.py's, on the
# reference and on ours alike; compare zooms on one estimator only.
# usage: steer.py <video> <t0> <dur> <fps> <width> <out.npz>
import sys

import cv2
import numpy as np

from vidio import dims, frames

src, t0, dur, fps, width, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
W, H = dims(src, width)
dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
m = 6
ys, xs = np.mgrid[m:H - m:3, m:W - m:3]
X = ((xs - (W - 1) / 2) / (H / 2)).ravel()
Y = (-(ys - (H - 1) / 2) / (H / 2)).ravel()
one, zero = np.ones_like(X), np.zeros_like(X)
A = np.concatenate([np.stack([one, zero, X, -Y], 1), np.stack([zero, one, Y, X], 1)])
prev, rows = None, []
for i, cur in enumerate(frames(src, t0, dur, fps, width)):
    if prev is not None:
        fl = dis.calc(prev, cur, None)
        y = np.concatenate([fl[ys, xs, 0].ravel(), -fl[ys, xs, 1].ravel()]) / (H / 2)
        keep = np.ones(len(y), bool)
        for _ in range(3):
            c, *_ = np.linalg.lstsq(A[keep], y[keep], rcond=None)
            res = np.abs(y - A @ c)
            keep = res <= np.percentile(res, 70)
        rows.append([t0 + (i - 0.5) / fps, *(c * fps)])
    prev = cur
r = np.array(rows)
np.savez(out, t=r[:, 0], a=r[:, 1], b=r[:, 2], z=r[:, 3], r=r[:, 4], fps=fps)
print(f"{out}: {len(r)} pairs; zoom median {np.median(r[:, 3]):+.3f}/s, |pan| median {np.median(np.abs(r[:, 1])):.3f}, "
      f"|tilt| median {np.median(np.abs(r[:, 2])):.3f} half-heights/s, |roll| median {np.degrees(np.median(np.abs(r[:, 4]))):.2f} deg/s")
