# Which way do rims face? For each bright ridge pixel, the direction from
# its darker flank to its brighter flank (12 px out). A light source would
# show a preferred azimuth; iso-lines or folds of a noise field would not.
# rimdir.py <frame.png>...
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
    l1 = tr / 2 - np.sqrt(np.maximum(tr * tr / 4 - det, 0))
    ridge = (l1 < np.percentile(l1, 2)) & (V > np.percentile(V, 93))
    ys, xs = np.nonzero(ridge)
    pick = np.random.default_rng(1).choice(len(ys), size=min(5000, len(ys)), replace=False)
    ang = []
    asym = []
    for i in pick:
        y, x = ys[i], xs[i]
        vx, vy = dxy[y, x], l1[y, x] - dxx[y, x]
        n = np.hypot(vx, vy)
        if n < 1e-6:
            continue
        vx, vy = vx / n, vy / n
        ya, xa = int(np.clip(round(y + 12 * vy), 0, Hh - 1)), int(np.clip(round(x + 12 * vx), 0, Ww - 1))
        yb, xb = int(np.clip(round(y - 12 * vy), 0, Hh - 1)), int(np.clip(round(x - 12 * vx), 0, Ww - 1))
        va, vb = V[ya, xa], V[yb, xb]
        if va < vb:  # point from the dark flank to the bright one
            vx, vy = -vx, -vy
        ang.append(np.degrees(np.arctan2(-vy, vx)) % 360)  # screen y up
        asym.append(abs(va - vb))
    ang = np.array(ang)
    h, _ = np.histogram(ang, bins=8, range=(0, 360))
    h = h / h.sum()
    R = np.abs(np.mean(np.exp(1j * np.radians(ang))))
    print(f"{path.split('/')[-1]}: dark->bright flank azimuth shares (0=right, 90=up, 45 deg bins): {h.round(3)}")
    print(f"  mean resultant length {R:.3f} (0 = no preferred side, 1 = all one way); |flank difference| p50 {np.median(asym):.3f}")
