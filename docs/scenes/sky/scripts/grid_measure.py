# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
"""Text-grid pitch and glyph brightness in the two grid references
(ref/07, ref/08): autocorrelation of bright-pixel row/column counts gives the
row and column pitch; bright-pixel RGB vs the median background gives the
glyph tint. Also prints single-glyph bitmaps ('#' bright, '+' mid).

    uv run grid_measure.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

REF = Path(__file__).resolve().parent.parent / "ref"


def pitch(sig, lo, hi):
    s = sig - sig.mean()
    ac = np.correlate(s, s, "full")[len(s) - 1 :]
    return lo + int(np.argmax(ac[lo:hi]))


for name, (x0, y0, x1, y1) in {
    "07-text-grid-streak.png": (0, 180, 760, 370),
    "08-text-grid-block-o-hotspot.png": (0, 0, 650, 440),
}.items():
    im = np.asarray(Image.open(REF / name).convert("RGB")).astype(float)
    sub = im[y0:y1, x0:x1]
    lum = 0.299 * sub[..., 0] + 0.587 * sub[..., 1] + 0.114 * sub[..., 2]
    bg = np.median(lum)
    bright = lum > bg + 25
    print(name, im.shape)
    print("  row pitch px", pitch(bright.sum(1), 10, 60), " col pitch px", pitch(bright.sum(0), 8, 40))
    print("  glyph RGB", sub[bright].mean(0).round(1), " bg RGB", np.median(sub.reshape(-1, 3), 0))

gray = np.asarray(Image.open(REF / "08-text-grid-block-o-hotspot.png").convert("L")).astype(int)
for label, (y0, y1, x0, x1) in {">": (150, 180, 95, 140), "o": (70, 100, 540, 600), "_": (380, 402, 350, 400)}.items():
    sub = gray[y0:y1, x0:x1]
    b = np.median(sub)
    print(f"glyph {label}:")
    for r in sub:
        print("  " + "".join("#" if v > b + 45 else ("+" if v > b + 20 else ".") for v in r))
