# Bright-rim profile on a full-resolution frame: rims.py <frame.png>...
# Ridge pixels = strong negative Hessian eigenvalue of V with V above the
# 93rd percentile; each is sampled across its ridge (+-40 px) and the
# profiles are averaged. Also prints the V on both flanks (12 px out) to
# test whether rims sit at one field level (iso-lines) or on any edge.
import sys

import cv2
import numpy as np

for path in sys.argv[1:]:
    a = cv2.cvtColor(cv2.imread(path), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    V = a.max(-1)
    Hh, Ww = V.shape
    s = cv2.GaussianBlur(V, (0, 0), 2.0)
    dxx = cv2.Sobel(s, cv2.CV_32F, 2, 0, ksize=5)
    dyy = cv2.Sobel(s, cv2.CV_32F, 0, 2, ksize=5)
    dxy = cv2.Sobel(s, cv2.CV_32F, 1, 1, ksize=5)
    tr, det = dxx + dyy, dxx * dyy - dxy * dxy
    disc = np.sqrt(np.maximum(tr * tr / 4 - det, 0))
    l1 = tr / 2 - disc  # most negative eigenvalue
    thr = np.percentile(V, 93)
    ridge = (l1 < np.percentile(l1, 2)) & (V > thr)
    ys, xs = np.nonzero(ridge)
    rng = np.random.default_rng(0)
    pick = rng.choice(len(ys), size=min(3000, len(ys)), replace=False)
    prof, flank_lo, flank_hi, peak = [], [], [], []
    offs = np.arange(-40, 41)
    for i in pick:
        y, x = ys[i], xs[i]
        # eigenvector of l1: (dxy, l1 - dxx)
        vx, vy = dxy[y, x], l1[y, x] - dxx[y, x]
        nrm = np.hypot(vx, vy)
        if nrm < 1e-6:
            continue
        vx, vy = vx / nrm, vy / nrm
        px = np.clip(np.round(x + offs * vx).astype(int), 0, Ww - 1)
        py = np.clip(np.round(y + offs * vy).astype(int), 0, Hh - 1)
        p = V[py, px]
        c = 40 + int(np.argmax(p[35:46])) - 5  # recentre on the local peak
        if c < 20 or c > 60:
            continue
        p = np.interp(np.arange(-20, 21) + c, np.arange(81), p)
        prof.append(p)
        lo, hi = sorted((p[20 - 12], p[20 + 12]))
        flank_lo.append(lo)
        flank_hi.append(hi)
        peak.append(p[20])
    prof = np.array(prof)
    m = prof.mean(0)
    base = (m[0] + m[-1]) / 2
    half = base + (m[20] - base) / 2
    above = np.nonzero(m >= half)[0]
    fwhm = above[-1] - above[0] + 1
    print(f"{path.split('/')[-1]}: {Ww}x{Hh}, {len(ys)} ridge px ({len(ys) / V.size * 100:.2f}% of frame), {len(prof)} profiles")
    print(f"  mean profile V at offsets 0,2,4,6,8,12,16,20 px: " +
          " ".join(f"{(m[20 - k] + m[20 + k]) / 2:.3f}" for k in (0, 2, 4, 6, 8, 12, 16, 20)))
    print(f"  FWHM {fwhm} px at this resolution; peak V p50 {np.median(peak):.3f}")
    print(f"  flank V 12 px out: low side p10/p50/p90 {np.percentile(flank_lo, [10, 50, 90]).round(3)}, "
          f"high side {np.percentile(flank_hi, [10, 50, 90]).round(3)}")
    rgb = a[ys[pick], xs[pick]]
    print(f"  ridge colour mean RGB {rgb.mean(0).round(3)}; B/R {np.median(rgb[:, 2] / np.maximum(rgb[:, 0], 1e-3)):.3f}, "
          f"G/R {np.median(rgb[:, 1] / np.maximum(rgb[:, 0], 1e-3)):.3f}")
