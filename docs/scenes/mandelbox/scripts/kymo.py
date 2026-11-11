# Time slices across a mirror's centre line, for looking at what seamflow.py measures: for each given row,
# the strip of pixels either side of the line, stacked frame under frame (time runs down), shown 2x.
# Content streaming into the line draws V shapes meeting on it; a camera on a 3D mirror plane can only draw
# curves that leave the line slowly.
# usage: kymo.py <video> <t0> <dur> <fps> <width> <half_strip_px> <out.png> <row as a share of the height...>
import sys

import numpy as np
from PIL import Image

from vidio import load

src, t0, dur, fps, width, hs, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), int(sys.argv[6]), sys.argv[7]
f = load(src, t0, dur, fps, width, gray=False)
n, H, W, _ = f.shape
c = W // 2
panels = []
for share in map(float, sys.argv[8:]):
    y = int(share * H)
    panels.append(f[:, y - 1:y + 2, c - hs:c + hs].mean(1).astype(np.uint8))
    panels.append(np.full((n, 4, 3), 255, np.uint8))
img = np.concatenate(panels[:-1], 1)
Image.fromarray(img).resize((img.shape[1] * 2, img.shape[0] * 2), Image.NEAREST).save(out)
print(out, img.shape)
