# uv run -q --with pillow --with numpy python framecheck.py <dir>
# Reads bakeframes.mjs's loop<n>-<phase>.png and prints, per loop, the lit
# bounding box over its frames (fractions of the frame, y down) and how many
# frames touch each edge: a head running off the top shows as "top".
import sys, glob, re, os
from collections import defaultdict
import numpy as np
from PIL import Image

LIT = 40  # of 255: above the bloom's faint halo on black
EDGE = 2  # px rows/columns counted as the frame's edge

rows = defaultdict(list)
for p in sorted(glob.glob(os.path.join(sys.argv[1], "loop*.png"))):
    loop = int(re.search(r"loop(\d+)-", p).group(1))
    lit = np.asarray(Image.open(p).convert("L"), dtype=np.uint8) > LIT
    ys, xs = np.nonzero(lit)
    if len(xs) == 0:
        continue
    h, w = lit.shape
    rows[loop].append((xs.min() / w, xs.max() / w, ys.min() / h, ys.max() / h,
                       lit[:EDGE].any(), lit[-EDGE:].any(), lit[:, :EDGE].any(), lit[:, -EDGE:].any()))
for loop in sorted(rows):
    r = rows[loop]
    box = (min(t[0] for t in r), max(t[1] for t in r), min(t[2] for t in r), max(t[3] for t in r))
    top, bottom, left, right = (sum(t[k] for t in r) for k in range(4, 8))
    print(f"loop {loop:2d}: x {box[0]:.2f}..{box[1]:.2f} y {box[2]:.2f}..{box[3]:.2f}"
          f" | touches top {top} bottom {bottom} left {left} right {right} of {len(r)}")
