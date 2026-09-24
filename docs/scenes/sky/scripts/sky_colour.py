# Sky: samples zenith/mid/horizon patches of a screenshot and reports mean
# RGB + HSV, for comparing our sky gradient against a reference still.
# Rescued from a working session on 2026-09-24.
# usage: python3 sky_colour.py <screenshot.png>
# May need adjusting to current code — the sample regions (pixel rects) were
# picked for a specific viewport size.
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
import colorsys
import sys

import numpy as np
from PIL import Image

im = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(float)
for name, (y0, y1, x0, x1) in {
    "zenith (top-right)": (20, 80, 1100, 1260),
    "mid-right": (380, 440, 1100, 1260),
    "horizon (bottom-right)": (700, 760, 1000, 1160),
}.items():
    c = im[y0:y1, x0:x1].reshape(-1, 3).mean(0)
    h, s, v = colorsys.rgb_to_hsv(*(c / 255))
    print(f"{name:24s} RGB {c.round()}  hue {h * 360:.0f}deg  sat {s:.2f}  val {v:.2f}")
