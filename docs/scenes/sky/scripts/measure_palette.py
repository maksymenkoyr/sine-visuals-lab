"""Sky: measures a palette reference's background colours.

Samples small blocks on a grid, drops blocks that sit inside the excluded
boxes or hold text (high local contrast, or near-black / near-white pixels),
and prints lightness percentiles with their mean colour, the darkest and
lightest 5%, and a k-means palette ordered dark to light. Colours print as
0..1 floats, the scale sky.ts's key tables use.

usage: python3 measure_palette.py <image> [x0,y0,x1,y1 ...]   (boxes to skip, pixels)
Written 2026-09-27 for the "darkest it gets" palette reference.
"""
import colorsys
import random
import sys

from PIL import Image

path = sys.argv[1]
boxes = [tuple(int(v) for v in b.split(",")) for b in sys.argv[2:]]
im = Image.open(path).convert("RGB")
W, H = im.size
px = im.load()
BLOCK, STEP = 6, 10


def inside(x, y):
    return any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in boxes)


samples = []  # (lightness, r, g, b, y)
for by in range(0, H - BLOCK, STEP):
    for bx in range(0, W - BLOCK, STEP):
        if inside(bx, by) or inside(bx + BLOCK, by + BLOCK):
            continue
        cols = [px[bx + i, by + j] for i in range(BLOCK) for j in range(BLOCK)]
        lums = [0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] for c in cols]
        if max(lums) - min(lums) > 18 or min(lums) < 25 or max(lums) > 250:
            continue  # text, logo or an edge
        r = sum(c[0] for c in cols) / len(cols) / 255
        g = sum(c[1] for c in cols) / len(cols) / 255
        b = sum(c[2] for c in cols) / len(cols) / 255
        samples.append((colorsys.rgb_to_hls(r, g, b)[1], r, g, b, by / H))


def fmt(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return f"({r:.3f}, {g:.3f}, {b:.3f})  hue {h * 360:5.1f}  light {l:.3f}  sat {s:.2f}  luma {luma:.3f}"


def mean(rows):
    n = len(rows)
    return sum(s[1] for s in rows) / n, sum(s[2] for s in rows) / n, sum(s[3] for s in rows) / n


samples.sort()
n = len(samples)
print(f"{n} background blocks")
for p in (1, 5, 10, 25, 50, 75, 90, 95, 99):
    i = min(n - 1, int(n * p / 100))
    lo, hi = max(0, i - n // 100), min(n, i + n // 100 + 1)
    print(f"p{p:<3} {fmt(*mean(samples[lo:hi]))}")
print(f"darkest 5%  {fmt(*mean(samples[: max(1, n // 20)]))}")
print(f"lightest 5% {fmt(*mean(samples[-max(1, n // 20):]))}")
hues = sorted(colorsys.rgb_to_hls(s[1], s[2], s[3])[0] * 360 for s in samples if colorsys.rgb_to_hls(s[1], s[2], s[3])[2] > 0.1)
print(f"hue p5..p95: {hues[len(hues) // 20]:.1f} .. {hues[-len(hues) // 20]:.1f}")

# k-means, k=6, on rgb
random.seed(1)
pts = [s[1:4] for s in samples]
cent = random.sample(pts, 6)
for _ in range(25):
    groups = [[] for _ in cent]
    for p in pts:
        k = min(range(len(cent)), key=lambda i: sum((p[c] - cent[i][c]) ** 2 for c in range(3)))
        groups[k].append(p)
    cent = [tuple(sum(p[c] for p in g) / len(g) for c in range(3)) if g else cent[i] for i, g in enumerate(groups)]
order = sorted(range(len(cent)), key=lambda i: colorsys.rgb_to_hls(*cent[i])[1])
print("palette (dark to light, share):")
for i in order:
    print(f"  {len(groups[i]) / n * 100:4.1f}%  {fmt(*cent[i])}")
