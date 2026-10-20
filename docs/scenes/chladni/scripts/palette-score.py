# Scores palette-shots.mjs output: per palette, the share of lit pixels
# (brightest channel at least 80) that read near-white (every channel over
# 200), and the lit pixels' mean HSV saturation. A second directory prints
# beside the first, for a before/after.
# usage: uv run --with pillow python palette-score.py <dir> [<dir2>]
import sys, os, colorsys
from PIL import Image


def score(path):
    im = Image.open(path).convert("RGB").resize((320, 180))
    lit = white = 0
    sat = 0.0
    for r, g, b in im.getdata():
        if max(r, g, b) < 80:
            continue
        lit += 1
        if min(r, g, b) > 200:
            white += 1
        sat += colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[1]
    return white / max(1, lit), sat / max(1, lit)


dirs = sys.argv[1:]
names = sorted(f[:-4] for f in os.listdir(dirs[0]) if f.endswith(".png"))
print(f"{'palette':10}" + "".join(f"  {'white%':>7} {'sat':>5}" for _ in dirs))
for n in names:
    row = f"{n:10}"
    for d in dirs:
        p = os.path.join(d, n + ".png")
        if os.path.exists(p):
            w, s = score(p)
            row += f"  {100 * w:7.1f} {s:5.2f}"
    print(row)
