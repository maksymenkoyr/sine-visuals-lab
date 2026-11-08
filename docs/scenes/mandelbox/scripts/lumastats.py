# Brightness statistics of frames, in the reference report's terms: mean brightness,
# share of pixels lit above the floor, mean saturation, and shares of five luma levels
# (the reference palette's levels, darkest first).
# usage: python lumastats.py <frame...>
import sys

import numpy as np
from PIL import Image

LEVELS = np.array([0.03, 0.16, 0.35, 0.57, 0.85])  # luma of the reference palette's five colours
print(f"{'frame':<22} mean  lit>.18  sat   shares at levels {LEVELS.tolist()}")
for path in sys.argv[1:]:
    im = np.asarray(Image.open(path).convert("RGB"), np.float32) / 255
    h = im.shape[0]
    im = im[: int(h * 0.9)]  # skip the bottom strip where the page's button sits
    lum = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mx, mn = im.max(-1), im.min(-1)
    sat = np.where(mx > 0.05, (mx - mn) / np.maximum(mx, 1e-6), 0)
    idx = np.abs(lum[..., None] - LEVELS).argmin(-1)
    shares = np.bincount(idx.ravel(), minlength=5) / idx.size
    name = path.split("/")[-1][:21]
    print(f"{name:<22} {lum.mean():.2f}  {np.mean(lum > 0.18):.2f}     {sat[mx > 0.05].mean():.2f}  {np.round(shares, 2).tolist()}")
