# Line colour (bright pixels minus local ground) and echo spacing along a few
# horizontal/vertical scan lines through the wall crop's regime frames.
#
#   uv run -q --with numpy --with pillow --with scipy python measure_lines.py tools/.cache/refs/livecode-wall
#
# Reads the bundle's frames/look_<n>.jpg (reference pixels — local cache
# only). Pixel numbers are on the 400 px wall crop; divide by circle_fit.py's
# radius to get them relative to the outline.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter, maximum_filter

base = sys.argv[1]
for name in ["look_1", "look_2", "look_3", "look_4"]:
    im = np.asarray(Image.open(f"{base}/frames/{name}.jpg").convert("RGB")).astype(np.float32) / 255
    lum = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    ground = uniform_filter(lum, 31)
    lift = lum - ground
    lit = lift > 0.12
    # colour of the line itself: (pixel - local ground colour), normalised
    gcol = np.stack([uniform_filter(im[..., c], 31) for c in range(3)], -1)
    diff = (im - gcol)[lit]
    mean = diff.mean(0)
    chroma = mean / mean.max()
    # stroke width: run lengths of lit pixels along rows
    runs = []
    for row in lit[::7]:
        r = 0
        for v in row:
            if v:
                r += 1
            elif r:
                runs.append(r); r = 0
    # echo spacing: distance between successive lit-run centres on rows, only runs <= 6 px
    gaps = []
    for row in lit[::5]:
        idx = np.flatnonzero(np.diff(np.concatenate([[0], row.astype(int), [0]])))
        starts, ends = idx[0::2], idx[1::2]
        centres = (starts + ends) / 2
        widths = ends - starts
        c = centres[widths <= 6]
        if len(c) > 1:
            g = np.diff(c)
            gaps.extend(g[(g > 3) & (g < 40)])
    print(f"{name}: lit {lit.mean()*100:.1f}%  line chroma rgb {chroma.round(2)}  lift {mean.max():.2f}  "
          f"stroke run median {np.median(runs):.1f}px  echo gap median {np.median(gaps):.1f}px p25 {np.percentile(gaps,25):.1f} p75 {np.percentile(gaps,75):.1f}")
