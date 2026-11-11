# Where the reference flies continuously and where it is busy: frame t warped onto frame t+lag along their
# optical flow (DIS), scored 1 - corr. Inside one continuous flight the warp explains the next second;
# across a cut or dissolve, and all through a clip mirrored afterwards (content keeps streaming in at the
# seam), it can't. Too noisy to count changes of look (it catches 14 of 18 seen by eye), but a 3 s median
# below 0.2 marks the calm, continuous stretches.
# usage: warplag.py <video> <t0> <dur> <fps> <lag_s> <width> <out.npz>
import sys

import cv2
import numpy as np

from vidio import dims, frames

src, t0, dur, fps, lag, width, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), int(sys.argv[6]), sys.argv[7]
W, H = dims(src, width)
dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
k = int(round(lag * fps))
m = 10  # border left out: the warp pulls in replicated edge pixels there


def corr(a, b):
    a = a[m:-m, m:-m].astype(np.float32)
    b = b[m:-m, m:-m].astype(np.float32)
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-9))


ring, T, R = [], [], []
for i, cur in enumerate(frames(src, t0, dur, fps, width)):
    ring.append(cur)
    if len(ring) > k:
        old = ring.pop(0)
        fl = dis.calc(cur, old, None)
        pred = cv2.remap(old, gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        T.append(t0 + (i - k / 2) / fps)
        R.append(1 - corr(pred, cur))
np.savez(out, t=np.array(T), resid=np.array(R), fps=fps, lag=lag)
print(out, len(T), "pairs")
