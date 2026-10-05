# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "pillow>=10.1"]
# ///
"""How much of each ring around the centre is white, grey and in between,
and its mean brightness — the check that set Chaikin Curves' edge width
against the reference (docs/scenes/chaikin.md, Measurements, 2026-10-06).

    uv run docs/scenes/chaikin/scripts/rings.py <frame.png|jpg> [<frame> ...]

r is in half-heights from the frame centre. A JPEG reference blurs its white
edges into the grey bands, so compare the mean, not the white share alone.
"""
import sys

import numpy as np
from PIL import Image

RINGS = [(0.15, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 0.95)]

for path in sys.argv[1:]:
    g = np.asarray(Image.open(path).convert("L"), dtype=np.float32) / 255
    h, w = g.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(xx - w / 2, yy - h / 2) / (h / 2)
    keep = (yy > 40) & (yy < h - 10) & (xx > 10) & (xx < w - 10)
    cols = []
    for a, b in RINGS:
        v = g[(r > a) & (r < b) & keep]
        grey = ((v > 0.15) & (v < 0.45)).mean()
        mid = ((v >= 0.45) & (v < 0.7)).mean()
        white = (v >= 0.7).mean()
        cols.append(f"{a}-{b}: mean {v.mean():.3f} grey {grey:.3f} mid {mid:.3f} white {white:.3f}")
    print(path)
    for c in cols:
        print("  " + c)
