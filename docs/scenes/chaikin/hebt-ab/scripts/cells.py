# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "scipy>=1.11"]
# ///
"""Measure the Voronoi reference as cells + seed dots, per sampled frame.

cells  = dark connected components (lum < DARK) with area >= MIN_CELL px
seeds  = bright holes inside a cell (the seed dot), area 2..SEED_MAX px
r      = distance from frame centre in half-heights (360 px)
"""
import json, sys, math
import numpy as np, cv2
from scipy.spatial import cKDTree

path = sys.argv[1]
STEP = int(sys.argv[2]) if len(sys.argv) > 2 else 3
DARK, MIN_CELL, SEED_MAX = 0.55, 12, 120
cap = cv2.VideoCapture(path)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
H = None
out = []
prev = None
i = -1
while True:
    ok, fr = cap.read()
    if not ok:
        break
    i += 1
    if i % STEP:
        continue
    g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    h, w = g.shape
    cx, cy, hh = w / 2, h / 2, h / 2
    dark = (g < DARK).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(dark, connectivity=4)
    cells = [(st[k, 4], cen[k]) for k in range(1, n) if st[k, 4] >= MIN_CELL]
    # seed dots: contours with hierarchy — holes in dark components
    cnts, hier = cv2.findContours(dark, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    seeds = []
    if hier is not None:
        for k, c in enumerate(cnts):
            if hier[0][k][3] >= 0:  # a hole
                a = cv2.contourArea(c)
                if 1 <= a <= SEED_MAX and len(c) >= 3:
                    m = cv2.moments(c)
                    if m["m00"] > 0:
                        seeds.append((m["m10"] / m["m00"], m["m01"] / m["m00"], a))
    lc = lab[int(cy), int(cx)]
    central = math.sqrt(st[lc, 4] / math.pi) / hh if lc else 0.0
    rs = np.array([math.hypot(c[0] - cx, c[1] - cy) / hh for _, c in cells])
    sz = np.array([math.sqrt(a) / hh for a, _ in cells])
    t = i / fps
    rec = {"t": round(t, 3), "cells": len(cells), "seeds": len(seeds), "central_r": round(central, 3),
           "lum": round(float(g.mean()), 4), "white": round(float((g > 0.7).mean()), 4)}
    bands = [(0, 0.15), (0.15, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 0.9), (0.9, 1.5)]
    rec["size_by_r"] = [round(float(np.median(sz[(rs >= a) & (rs < b)])), 4) if ((rs >= a) & (rs < b)).sum() >= 3 else None for a, b in bands]
    rec["count_by_r"] = [int(((rs >= a) & (rs < b)).sum()) for a, b in bands]
    # track seeds from the previous sampled frame
    S = np.array([(x, y) for x, y, _ in seeds]) if seeds else np.zeros((0, 2))
    if prev is not None and len(prev) and len(S):
        tree = cKDTree(prev)
        d, j = tree.query(S, distance_upper_bound=12)
        vr, vt, rr, born = [], [], [], []
        for (x, y), dd, jj in zip(S, d, j):
            r1 = math.hypot(x - cx, y - cy) / hh
            if math.isinf(dd):
                born.append(r1)
                continue
            px, py = prev[jj]
            r0 = math.hypot(px - cx, py - cy) / hh
            a0 = math.atan2(py - cy, px - cx); a1 = math.atan2(y - cy, x - cx)
            da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
            dt = STEP / fps
            rr.append(r0); vr.append((r1 - r0) / dt); vt.append(-da / dt)  # + = ccw on screen (y down)
        rr, vr, vt = map(np.array, (rr, vr, vt))
        rec["tracked"] = int(len(rr))
        rec["born_r"] = [round(b, 3) for b in born]
        ok = rr > 0.08
        if ok.sum() > 5:
            k = vr[ok] / rr[ok]
            rec["k_med"] = round(float(np.median(k)), 4)       # radial speed / r, 1/s (log zoom rate)
            rec["spin_med"] = round(float(np.degrees(np.median(vt[ok]))), 2)  # deg/s
            rec["out_share"] = round(float((vr[ok] > 0).mean()), 3)
            # speed vs r law
            sel = ok & (np.abs(vr) > 1e-4)
            if sel.sum() > 10:
                p = np.polyfit(np.log(rr[sel]), np.log(np.abs(vr[sel])), 1)
                rec["v_exp"] = round(float(p[0]), 2)
    prev = S
    out.append(rec)
json.dump(out, open(sys.argv[3] if len(sys.argv) > 3 else "cells.json", "w"))
# summary in 2 s bins
def agg(a, b, key, f=np.median):
    v = [r[key] for r in out if a <= r["t"] < b and r.get(key) is not None]
    return f(v) if v else float("nan")
print("t      cells seeds centralR  k(1/s) spin  out%  vexp  born/s  bornR(med,p10,p90)  size r<.15 .15-.3 .3-.5 .5-.7 .7-.9 >.9")
for a in range(0, 50, 2):
    b = a + 2
    seg = [r for r in out if a <= r["t"] < b]
    born = [x for r in seg for x in r.get("born_r", [])]
    nb = len(born) / 2
    br = (np.median(born), np.percentile(born, 10), np.percentile(born, 90)) if born else (float("nan"),) * 3
    sizes = []
    for j in range(6):
        v = [r["size_by_r"][j] for r in seg if r["size_by_r"][j] is not None]
        sizes.append(f"{np.median(v):.3f}" if v else "  -  ")
    print(f"{a:2d}-{b:2d}  {agg(a,b,'cells'):5.0f} {agg(a,b,'seeds'):5.0f} {agg(a,b,'central_r'):6.3f}  {agg(a,b,'k_med'):+.3f} {agg(a,b,'spin_med'):+5.1f} {agg(a,b,'out_share')*100:4.0f} {agg(a,b,'v_exp'):5.2f} {nb:6.0f}  {br[0]:.2f},{br[1]:.2f},{br[2]:.2f}   " + " ".join(sizes))
