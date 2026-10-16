# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
"""The reference's breath metric (measure_breath.py) applied to our PNG shots:
white-core r90 and coloured-rim r50 in half-heights from the lit centroid.
Our 1280x720 shots: the UI corners are masked."""
import sys, numpy as np, cv2

rows = []
for p in sys.argv[1:]:
    f = cv2.imread(p).astype(np.float32) / 255
    f[:90, :460] = 0
    f[-70:, -120:] = 0
    h = f.shape[0]; hh = h / 2
    b, g, r = f[..., 0], f[..., 1], f[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    sat = f.max(-1) - f.min(-1)
    white = (lum > 0.45) & (sat < 0.18)
    colour = (lum > 0.12) & (sat > 0.25)
    ys, xs = np.nonzero(lum > 0.1)
    cx, cy = xs.mean(), ys.mean()

    def rad(mask, q):
        yy, xx = np.nonzero(mask)
        return float(np.percentile(np.hypot(xx - cx, yy - cy) / hh, q)) if len(xx) > 20 else float("nan")

    rows.append((rad(white, 90), rad(colour, 50), white.mean(), colour.mean()))
    print(f"{p.split('/')[-1]:24s} core r90 {rows[-1][0]:.2f}  rim r50 {rows[-1][1]:.2f}  white {rows[-1][2]*100:.1f}%  colour {rows[-1][3]*100:.1f}%")
a = np.array(rows)
print(f"core r90 p10/p90 {np.nanpercentile(a[:,0],10):.2f}/{np.nanpercentile(a[:,0],90):.2f}  rim r50 median {np.nanmedian(a[:,1]):.2f}")
