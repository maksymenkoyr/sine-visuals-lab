# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "scipy>=1.11"]
# ///
"""Count particles (bright node dots where edges meet) in a few frames of the
entropic-collapse reference: local maxima of a blurred luminance above the
edge level. Rim nodes = those at r > 0.38 half-heights from the centroid."""
import sys, numpy as np, cv2
from scipy.ndimage import maximum_filter
cap = cv2.VideoCapture(sys.argv[1]); fps = cap.get(cv2.CAP_PROP_FPS)
for t in map(float, sys.argv[2].split(",")):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps)); ok, f = cap.read()
    f = f.astype(np.float32) / 255; f[:60, :260] = 0
    h = f.shape[0]; lum = f.max(-1)
    bl = cv2.GaussianBlur(lum, (0, 0), 1.5)
    pk = (bl == maximum_filter(bl, size=9)) & (bl > 0.35)
    ys, xs = np.nonzero(lum > 0.1); cx, cy = xs.mean(), ys.mean()
    py, px = np.nonzero(pk); r = np.hypot(px - cx, py - cy) / (h / 2)
    edge_px = (lum > 0.1).sum()
    print(f"t {t:5.1f}s  nodes {len(px):4d}  rim(r>0.38) {int((r>0.38).sum()):3d}  lit px {edge_px}")
