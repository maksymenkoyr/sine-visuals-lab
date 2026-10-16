# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "scipy>=1.11"]
# ///
"""Per-frame radial profile of the entropic-collapse reference: white-core
radius, coloured-rim radius, the breathing period, and a rim particle count.
r is in half-heights from the swarm's centroid (the frame centre drifts)."""
import sys, json, numpy as np, cv2
from scipy.signal import find_peaks
path = sys.argv[1]
cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS)
rows = []
i = 0
while True:
    ok, f = cap.read()
    if not ok: break
    f = f.astype(np.float32) / 255
    f[:60, :260] = 0  # the author's slider overlay
    h, w = f.shape[:2]; hh = h / 2
    b, g, r = f[..., 0], f[..., 1], f[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    sat = f.max(-1) - f.min(-1)
    white = (lum > 0.45) & (sat < 0.18)
    colour = (lum > 0.12) & (sat > 0.25)
    lit = lum > 0.1
    ys, xs = np.nonzero(lit)
    if len(xs) < 50: rows.append(None); i += 1; continue
    cx, cy = xs.mean(), ys.mean()
    def rad(mask):
        yy, xx = np.nonzero(mask)
        if len(xx) < 20: return None
        d = np.hypot(xx - cx, yy - cy) / hh
        return [float(np.percentile(d, p)) for p in (50, 90)]
    wr, cr = rad(white), rad(colour)
    rows.append(dict(t=i / fps, cx=cx / w, cy=cy / h, white=wr, colour=cr,
                     white_px=int(white.sum()), colour_px=int(colour.sum()), lum=float(lum.mean())))
    i += 1
json.dump(rows, open(sys.argv[2], "w"))
t = np.array([x["t"] for x in rows if x and x["white"]])
wr90 = np.array([x["white"][1] for x in rows if x and x["white"]])
cr50 = np.array([x["colour"][0] if x["colour"] else np.nan for x in rows if x and x["white"]])
print("frames", len(rows), "fps", fps)
# windows of 5 s: breathing period from white-radius peaks, amplitude, rim radius
for t0 in range(0, 86, 5):
    m = (t >= t0) & (t < t0 + 5)
    if m.sum() < 30: continue
    x = wr90[m]; pk, _ = find_peaks(x, distance=8, prominence=0.04)
    per = float(np.median(np.diff(t[m][pk]))) if len(pk) > 2 else float("nan")
    print(f"{t0:3d}-{t0+5:<3d}s core r90 p10/p90 {np.percentile(x,10):.2f}/{np.percentile(x,90):.2f}  "
          f"rim r50 {np.nanmedian(cr50[m]):.2f}  peaks {len(pk):2d}  period {per:.2f}s")
