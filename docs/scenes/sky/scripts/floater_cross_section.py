# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
"""Brightness cross-sections across floaters: one row of luminance values
through a strand, printed left to right relative to the row's median. On
ref/06 this is what showed a floater is a hollow refractive tube: dark
fringe, bright rim, near-sky centre, bright rim, dark fringe.

    uv run floater_cross_section.py IMAGE Y X0 X1 [Y X0 X1 ...]

The rows used on 2026-09-23 for ref/06-floaters-hollow-tubes.png were
150 270 350 / 560 400 470 / 300 720 800 (strands) and 548 170 230 (a dot).
"""
import sys

import numpy as np
from PIL import Image

im = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(float)
args = list(map(int, sys.argv[2:]))
for y, x0, x1 in zip(args[0::3], args[1::3], args[2::3]):
    row = im[y, x0:x1]
    lum = (0.299 * row[:, 0] + 0.587 * row[:, 1] + 0.114 * row[:, 2]).round().astype(int)
    bg = int(np.median(lum))
    print(f"y={y} x={x0}..{x1} bg~{bg}: {' '.join(str(v - bg) for v in lum)}")
