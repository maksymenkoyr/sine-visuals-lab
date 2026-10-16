# How much of the plate's light sits on its lines, per variant, from
# plate-shots.mjs --burst frames (<name>-NN.png): the share of brightness in
# the brightest 10% of the plate's pixels (higher = sand gathered on crisper
# lines), and the mean luma. The black surround is left out.
# usage: uvx --with pillow --with numpy python docs/scenes/chladni/scripts/plate-lines.py <dir>
import collections
import glob
import os
import sys

import numpy as np
from PIL import Image

groups = collections.defaultdict(list)
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*-[0-9][0-9].png"))):
    name = os.path.basename(path).rsplit("-", 1)[0]
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    plate = np.sort(lum[lum > 3].ravel())[::-1]
    groups[name].append((plate[: max(1, len(plate) // 10)].sum() / plate.sum(), lum.mean()))
for name, vals in groups.items():
    top = np.array([v[0] for v in vals])
    luma = np.array([v[1] for v in vals])
    print(f"{name:20s} top-10% share {top.mean():.3f} ({top.min():.3f}-{top.max():.3f})  mean luma {luma.mean():.1f}")
