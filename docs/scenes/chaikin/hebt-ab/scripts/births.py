# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "scipy>=1.11"]
# ///
"""Track seed dots at every frame: births (where/when a persistent dot first
appears), and radial speed / r by radius band (is it a flat zoom?)."""
import sys, math
import numpy as np, cv2
from scipy.spatial import cKDTree

cap = cv2.VideoCapture(sys.argv[1])
fps = cap.get(cv2.CAP_PROP_FPS) or 30
DARK, SEED_MAX, MATCH, PERSIST = 0.55, 120, 5.0, 6
tracks = []  # each: dict(t0, pts=[(t,x,y)], alive)
live = []
i = -1
cx = cy = hh = None
while True:
    ok, fr = cap.read()
    if not ok:
        break
    i += 1
    t = i / fps
    g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
    h, w = g.shape
    cx, cy, hh = w / 2, h / 2, h / 2
    dark = (g < DARK * 255).astype(np.uint8)
    cnts, hier = cv2.findContours(dark, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    pts = []
    if hier is not None:
        for k, c in enumerate(cnts):
            if hier[0][k][3] >= 0:
                a = cv2.contourArea(c)
                if 1 <= a <= SEED_MAX:
                    m = cv2.moments(c)
                    if m["m00"] > 0:
                        pts.append((m["m10"] / m["m00"], m["m01"] / m["m00"]))
    P = np.array(pts) if pts else np.zeros((0, 2))
    used = np.zeros(len(P), bool)
    if len(P) and live:
        tree = cKDTree(P)
        nxt = []
        for tr in live:
            _, lx, ly = tr["pts"][-1]
            d, j = tree.query((lx, ly), distance_upper_bound=MATCH)
            if not math.isinf(d) and not used[j]:
                used[j] = True
                tr["pts"].append((t, *P[j]))
                tr["miss"] = 0
                nxt.append(tr)
            else:
                tr["miss"] += 1
                (nxt if tr["miss"] <= 2 else tracks).append(tr)
        live = nxt
    for j in np.where(~used)[0]:
        live.append({"t0": t, "pts": [(t, *P[j])], "miss": 0})
tracks += live

def r_of(x, y):
    return math.hypot(x - cx, y - cy) / hh

long = [tr for tr in tracks if len(tr["pts"]) >= PERSIST]
# births: tracks that start after the first frame and persist; check no dot
# was there just before (a fresh dot, not a re-acquired one): first frames only
births = [(tr["t0"], r_of(*tr["pts"][0][1:])) for tr in long if tr["t0"] > 0.1]
print(f"{len(tracks)} tracks, {len(long)} persistent (>= {PERSIST} frames)")
print("births per 2 s window: count, per s, radius quantiles p10/p25/p50/p75/p90")
B = np.array(births)
for a in range(0, 50, 2):
    sel = B[(B[:, 0] >= a) & (B[:, 0] < a + 2)]
    if len(sel):
        q = np.percentile(sel[:, 1], [10, 25, 50, 75, 90])
        print(f"{a:2d}-{a+2:2d}s  {len(sel):4d} {len(sel)/2:6.1f}/s  " + " ".join(f"{v:.2f}" for v in q))
# k = (d r / dt) / r per band, from persistent tracks, t windows
print("\nk = radial speed / r (1/s) by band, median over track segments of 0.5 s")
bands = [(0.05, 0.15), (0.15, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 0.9), (0.9, 1.3)]
for a, b in [(0, 4), (4, 8), (8, 12), (12, 16), (16, 20), (20, 30), (30, 50)]:
    rows = {k: [] for k in range(len(bands))}
    for tr in long:
        p = tr["pts"]
        for s in range(0, len(p) - 15, 15):
            t0, x0, y0 = p[s]; t1, x1, y1 = p[s + 15]
            if not (a <= t0 < b):
                continue
            r0, r1 = r_of(x0, y0), r_of(x1, y1)
            rm = (r0 + r1) / 2
            for bi, (lo, hi) in enumerate(bands):
                if lo <= rm < hi:
                    rows[bi].append(math.log(max(r1, 1e-3) / max(r0, 1e-3)) / (t1 - t0))
    print(f"{a:2d}-{b:2d}s  " + "  ".join(f"r{lo:.2f}-{hi:.2f}: {np.median(v):+.3f} (n{len(v)})" if len(v) >= 5 else f"r{lo:.2f}-{hi:.2f}:   -   " for bi, (lo, hi) in enumerate(bands) for v in [rows[bi]]))
# lifetimes: how long a seed stays on screen in the steady state
life = [tr["pts"][-1][0] - tr["t0"] for tr in long if tr["t0"] > 20]
print(f"\nsteady-state persistent track length median {np.median(life):.2f}s p90 {np.percentile(life, 90):.2f}s")
