# stats.py img... : per image, mean luma, share of pixels with luma > 0.35 / > 0.6,
# mean saturation, and the median hue (deg) of lit pixels. Crops the app's chrome
# (top 100 px and bottom 70 px of a 720p shot) when --crop is given.
import sys
import numpy as np
from PIL import Image

crop = "--crop" in sys.argv
for path in [a for a in sys.argv[1:] if not a.startswith("--")]:
    im = np.asarray(Image.open(path).convert("RGB").resize((640, 360))).astype(np.float32) / 255
    if crop:
        im = im[50:-35]
    luma = im @ np.array([0.2126, 0.7152, 0.0722])
    mx, mn = im.max(-1), im.min(-1)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    hue = (np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) + 360) % 360
    lit = luma > 0.35
    print(f"{path.split('/')[-1]:28s} luma {luma.mean():.3f}  >0.35 {lit.mean():.3f}  >0.6 {(luma > 0.6).mean():.3f}  "
          f"sat {sat.mean():.2f}  hue(lit) {np.median(hue[lit]) if lit.any() else float('nan'):.0f}  p10/p50/p90 "
          f"{np.percentile(luma, 10):.2f}/{np.percentile(luma, 50):.2f}/{np.percentile(luma, 90):.2f}")
