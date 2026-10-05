# Fit the reference's clean circle (a frame with no echoes, e.g. 20.2 s of
# the wall crop) to get its radius in crop pixels — the unit the stroke and
# echo-gap measurements in measure_lines.py are divided by.
#
#   uv run -q --with numpy --with pillow --with scipy python circle_fit.py <frame.png>
#
# Takes the brightest 1.5 % of pixels above the local wall level (the line,
# not the haze), skips the live-code text block in the top-left corner, then
# refits the circle a few times keeping only pixels near the last fit — the
# haze beams' edges pull a single least-squares fit off.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

im = np.asarray(Image.open(sys.argv[1]).convert("L")).astype(np.float32) / 255
lift = im - uniform_filter(im, 31)
ys, xs = np.nonzero(lift > np.percentile(lift, 98.5))
keep = ~((xs < 170) & (ys < 120))
xs, ys = xs[keep].astype(float), ys[keep].astype(float)


def fit(xs, ys):
    a = np.c_[2 * xs, 2 * ys, np.ones_like(xs)]
    cx, cy, c = np.linalg.lstsq(a, xs**2 + ys**2, rcond=None)[0]
    return cx, cy, np.sqrt(c + cx**2 + cy**2)


cx, cy, r = fit(xs, ys)
for _ in range(4):
    near = np.abs(np.hypot(xs - cx, ys - cy) - r) < 6
    xs, ys = xs[near], ys[near]
    cx, cy, r = fit(xs, ys)
print(f"centre ({cx:.0f},{cy:.0f}) r {r:.1f}px from {len(xs)} px, frame {im.shape}")
