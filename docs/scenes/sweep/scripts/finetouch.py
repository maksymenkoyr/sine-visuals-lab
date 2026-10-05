# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "scikit-learn>=1.4"]
# ///
"""
Fine-touch checks on the Colorem reel.

  uv run finetouch.py <video>

1. Overlap blend: k-means the object colours of a frame, then for every
   triple (A, B, C) test C against multiply (A·B) and against the best
   alpha-over mix of A and B. Multiply's signature: the overlap is darker
   than both.
2. Chromatic split: phase-correlate the high-passed R and B channels against
   G in a 3×3 grid of tiles; constant vectors = a fixed offset, vectors
   pointing out from (or into) the centre = radial (lens-like) split.
3. Copy spacing: along the line from Contours' red head out to the far end
   of its trail, the positions of the stripes' dark lines and the gaps
   between them, head first.
"""
import itertools
import sys

import cv2
import numpy as np
from sklearn.cluster import KMeans

cap = cv2.VideoCapture(sys.argv[1])
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
h, w, _ = frames[0].shape


def hexc(c):
    return "#" + "".join(f"{int(round(x)):02x}" for x in np.clip(c, 0, 255))


def overlap(i, label, k=7):
    f = frames[i].astype(np.float32)
    ground = np.median(np.concatenate([f[:12].reshape(-1, 3), f[-12:].reshape(-1, 3)]), axis=0)
    obj = np.linalg.norm(f - ground, axis=2) > 40
    obj[: int(0.14 * h), int(0.76 * w) : int(0.92 * w)] = False
    px = f[obj][::7]
    km = KMeans(n_clusters=k, n_init=4, random_state=0).fit(px)
    share = np.bincount(km.labels_, minlength=k) / len(km.labels_)
    C = km.cluster_centers_
    best = []
    for a, b, c in itertools.permutations(range(k), 3):
        if a > b or min(share[a], share[b], share[c]) < 0.04:
            continue
        mult = C[a] * C[b] / 255.0
        em = np.linalg.norm(mult - C[c])
        # best alpha-over: c = A + t (B - A), t in [0,1]
        ab = C[b] - C[a]
        t = np.clip(np.dot(C[c] - C[a], ab) / max(np.dot(ab, ab), 1e-6), 0, 1)
        eo = np.linalg.norm(C[a] + t * ab - C[c])
        best.append((em, eo, a, b, c, t))
    best.sort()
    print(f"{label} (frame {i}): clusters " + " ".join(f"{hexc(C[j])}×{share[j]:.2f}" for j in np.argsort(-share)))
    for em, eo, a, b, c, t in best[:3]:
        lum = lambda v: 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
        darker = lum(C[c]) < min(lum(C[a]), lum(C[b]))
        print(
            f"  {hexc(C[a])} × {hexc(C[b])} = {hexc(C[a] * C[b] / 255)} vs overlap {hexc(C[c])}: "
            f"multiply err {em:.0f}, alpha-over err {eo:.0f} (t {t:.2f}); overlap darker than both: {darker}"
        )


def chroma(i, label):
    f = frames[i].astype(np.float32)
    hp = [ch - cv2.GaussianBlur(ch, (0, 0), 3) for ch in cv2.split(f)]
    out = []
    win = cv2.createHanningWindow((w // 3, h // 3), cv2.CV_32F)
    for gy in range(3):
        row = []
        for gx in range(3):
            sl = (slice(gy * h // 3, (gy + 1) * h // 3), slice(gx * w // 3, (gx + 1) * w // 3))
            r, g, b = (x[sl] for x in hp)
            if np.abs(g).mean() < 0.4:
                row.append("   .   ")
                continue
            (rx, ry), rr = cv2.phaseCorrelate(g, r, win)
            (bx, by), rb = cv2.phaseCorrelate(g, b, win)
            row.append(f"R({rx:+.1f},{ry:+.1f}) B({bx:+.1f},{by:+.1f})")
        out.append("  ".join(row))
    print(f"{label} (frame {i}) — R and B shift vs G per tile, px (x right, y down):")
    for line in out:
        print("   ", line)


def spacing(i):
    f = frames[i].astype(np.float32)
    red = (f[..., 0] > 190) & (f[..., 1] < 110) & (f[..., 2] < 110)
    hy, hx = np.nonzero(red)
    head = np.array([hx.mean(), hy.mean()])
    ground = np.median(f[:12].reshape(-1, 3), axis=0)
    obj = np.linalg.norm(f - ground, axis=2) > 30
    oy, ox = np.nonzero(obj)
    dist = np.hypot(ox - head[0], oy - head[1])
    far = np.array([ox[np.argmax(dist)], oy[np.argmax(dist)]])
    d = (far - head) / np.linalg.norm(far - head)
    L = int(np.linalg.norm(far - head))
    lum = cv2.GaussianBlur(cv2.cvtColor(frames[i], cv2.COLOR_RGB2GRAY).astype(np.float32), (0, 0), 0.8)
    ts = np.arange(0, L)
    xs = np.clip(head[0] + ts * d[0], 0, w - 1).astype(int)
    ys = np.clip(head[1] + ts * d[1], 0, h - 1).astype(int)
    v = lum[ys, xs]
    mins = [t for t in range(2, len(v) - 2) if v[t] < v[t - 1] and v[t] <= v[t + 1] and v[t] < max(v[max(0, t - 6) : t + 7]) - 25]
    gaps = np.diff(mins)
    print(f"contour spacing (frame {i}), head ({head[0]:.0f},{head[1]:.0f}) → far end, {L} px:")
    print(f"  dark lines at px from head: {mins}")
    print(f"  gaps: {list(gaps)}")
    if len(gaps) > 3:
        r = gaps[1:] / np.maximum(gaps[:-1], 1)
        print(f"  gap ratio next/prev: median {np.median(r):.2f} (1 = even spacing, >1 = bunched toward the head)")


overlap(int(13.4 * 30), "Panels")
overlap(int(15.27 * 30), "Cubes")
overlap(int(9.5 * 30), "Rings")
chroma(int(13.4 * 30), "Panels")
chroma(int(5.4 * 30), "Halo")
chroma(int(15.4 * 30), "Cubes")
chroma(int(3.4 * 30), "Contours")
spacing(int(3.4 * 30))
spacing(int(3.9 * 30))
