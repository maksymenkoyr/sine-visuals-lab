# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "scikit-image>=0.22"]
# ///
import cv2, numpy as np, sys, math
from skimage.morphology import skeletonize
cap = cv2.VideoCapture(sys.argv[1])
frames = {int(t * 30) for t in (30, 35, 40, 45)} | {56, 150}
i = -1
while True:
    ok, fr = cap.read()
    if not ok: break
    i += 1
    if i not in frames: continue
    g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    h, w = g.shape; cx, cy, hh = w / 2, h / 2, h / 2
    yy, xx = np.mgrid[0:h, 0:w]; R = np.hypot(xx - cx, yy - cy) / hh
    band = (R > 0.35) & (R < 0.9)
    white = (g > 0.5).astype(np.uint8)
    dt = cv2.distanceTransform(white, cv2.DIST_L2, 3)
    sk = skeletonize(white.astype(bool)) & band
    width = 2 * dt[sk] - 1   # full width through the skeleton
    # edges (exclude vertex triangles and dots): skeleton points with small dt
    w_med = np.median(width); w_p25, w_p75 = np.percentile(width, [25, 75])
    # cells
    dark = (g < 0.5).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(dark, connectivity=4)
    rs, A = [], []
    for k in range(1, n):
        r = math.hypot(cen[k][0] - cx, cen[k][1] - cy) / hh
        if 0.3 < r < 0.9 and st[k, 4] > 30:
            rs.append(r); A.append(st[k, 4] / (hh * hh))
    rs, A = np.array(rs), np.array(A)
    norm = A / rs**2
    # Delaunay lines: inside cells (eroded dark interior), brightness of line pixels
    inner = cv2.erode(dark, np.ones((5, 5), np.uint8)) .astype(bool) & band
    vals = g[inner]
    line = vals[vals > 0.12]
    # dots: small white blobs fully inside dark cells = holes
    cnts, hier = cv2.findContours(dark, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    dots = [cv2.contourArea(c) for k, c in enumerate(cnts) if hier[0][k][3] >= 0 and 2 <= cv2.contourArea(c) <= 150]
    dd = [2 * math.sqrt(a / math.pi) for a in dots]
    # edge glow: mean lum vs distance from white (dark side)
    dtd = cv2.distanceTransform(dark, cv2.DIST_L2, 3)
    prof = [float(np.median(g[(dtd > d - 0.5) & (dtd <= d + 0.5) & band])) for d in (1, 2, 3, 4, 6)]
    print(f"t{i/30:5.2f} edge width px med {w_med:.1f} (p25 {w_p25:.1f}, p75 {w_p75:.1f}) | cells {len(A)} area/r^2 med {np.median(norm):.4f} CV {norm.std()/norm.mean():.2f} | "
          f"line px share {len(line)/max(1,len(vals)):.3f} line lum med {np.median(line) if len(line) else 0:.2f} p90 {np.percentile(line,90) if len(line) else 0:.2f} | dots {len(dd)} diam med {np.median(dd) if dd else 0:.1f}px | dark-side lum at d=1,2,3,4,6px: " + " ".join(f"{p:.2f}" for p in prof))
    if i == max(frames): break
