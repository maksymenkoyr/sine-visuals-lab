# Hue shares of lit pixels (luma > 0.21, reflook's lit floor) in 30-degree bins, plus the
# luma percentiles of lit pixels: hues.py img... (app chrome is hidden in rest.mjs shots)
import sys
import numpy as np
from PIL import Image

NAMES = {0: "red", 30: "orange", 60: "yellow", 90: "lime", 120: "green", 150: "teal", 180: "cyan",
         210: "azure", 240: "blue", 270: "violet", 300: "magenta", 330: "rose"}
for path in sys.argv[1:]:
    im = np.asarray(Image.open(path).convert("RGB").resize((640, 360))).astype(np.float32) / 255
    luma = im @ np.array([0.2126, 0.7152, 0.0722])
    mx, mn = im.max(-1), im.min(-1)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    hue = (np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) + 360) % 360
    lit = luma > 0.21
    bins = ((hue[lit] + 15) // 30 * 30) % 360
    vals, counts = np.unique(bins, return_counts=True)
    order = np.argsort(-counts)
    share = " ".join(f"{NAMES[int(vals[i])]} {counts[i] / lit.sum():.2f}" for i in order[:5])
    print(f"{path.split('/')[-1]:22s} lit {lit.mean():.2f}  sat(lit) {sat[lit].mean():.2f}  "
          f"luma(lit) p50 {np.median(luma[lit]):.2f} p90 {np.percentile(luma[lit], 90):.2f}  | {share}")
