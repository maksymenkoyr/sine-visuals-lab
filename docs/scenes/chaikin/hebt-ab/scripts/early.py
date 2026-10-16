# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
"""Early phase: central cell radius, where the tiniest (newest) cells sit, and
how many cells per radius band. Also edge/gap and dot geometry at a few times."""
import sys, math
import numpy as np, cv2

cap = cv2.VideoCapture(sys.argv[1])
fps = cap.get(cv2.CAP_PROP_FPS) or 30
DARK, MIN_CELL = 0.55, 6
i = -1
print("t     cells  centralR  tiny(n, r_med, ang_deg, R)   count by r: <.15 .15-.3 .3-.5 .5-.7 .7-.9 >.9")
while True:
    ok, fr = cap.read()
    if not ok:
        break
    i += 1
    t = i / fps
    if t > 24:
        break
    if i % 15:
        continue
    g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    h, w = g.shape
    cx, cy, hh = w / 2, h / 2, h / 2
    dark = (g < DARK).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(dark, connectivity=4)
    win = lab[int(cy) - 6:int(cy) + 7, int(cx) - 6:int(cx) + 7].ravel()
    win = win[win > 0]
    lc = np.bincount(win).argmax() if len(win) else 0
    central = math.sqrt(st[lc, 4] / math.pi) / hh if lc else 0.0
    ks = [k for k in range(1, n) if st[k, 4] >= MIN_CELL and k != lc]
    rs = np.array([math.hypot(cen[k][0] - cx, cen[k][1] - cy) / hh for k in ks])
    an = np.array([math.atan2(-(cen[k][1] - cy), cen[k][0] - cx) for k in ks])  # math angle, ccw, 0 = right
    sz = np.array([math.sqrt(st[k, 4]) / hh for k in ks])
    # tiny relative to the scale-invariant law (size ≈ 0.13 r): newest seeds
    tiny = (sz < 0.045 * np.maximum(rs, 0.05) / 0.35) & (rs > 0.08)
    if tiny.sum():
        C = np.mean(np.cos(an[tiny])); S = np.mean(np.sin(an[tiny]))
        tinfo = f"{tiny.sum():4d} {np.median(rs[tiny]):.2f} {math.degrees(math.atan2(S, C)):+5.0f} {math.hypot(C, S):.2f}"
    else:
        tinfo = "   0    -     -     - "
    bands = [(0, 0.15), (0.15, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 0.9), (0.9, 1.5)]
    cb = " ".join(f"{int(((rs >= a) & (rs < b)).sum()):4d}" for a, b in bands)
    print(f"{t:5.1f} {len(ks)+1:5d}  {central:6.3f}   {tinfo}      {cb}")
