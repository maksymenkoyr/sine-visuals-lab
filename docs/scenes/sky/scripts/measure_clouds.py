"""Sky: measures a blue-sky cloud picture (a reference photo or our render)
as structure, so the two can be compared number for number.

Cloudness per pixel is how far its blue-minus-red falls below the clear sky's
(1 = white cloud, 0 = clear sky); a pixel is cloud above 0.5. Prints coverage
and how evenly it spreads over a 3x3 grid, how many separate clouds there are
and how big (equivalent diameter over sqrt(frame area)), how much of the
cloud area the biggest one holds, outline crinkliness (perimeter^2 / 4 pi
area, 1 = a disc), edge softness (half-cloud pixels per cloud pixel), and
the sky and cloud colours. Optionally writes the mask for a visual check.

usage: uv run --with numpy --with scipy --with pillow python3 measure_clouds.py <image>
         [--crop x0,y0,x1,y1] [--skip x0,y0,x1,y1 ...] [--mask out.png]
Written 2026-09-27 for the scattered-cumulus reference.
"""
import sys

import numpy as np
import scipy.ndimage as ndi
from PIL import Image

args = sys.argv[1:]
path = args.pop(0)
crop, skips, mask_out = None, [], None
while args:
    flag = args.pop(0)
    if flag == "--crop":
        crop = [int(v) for v in args.pop(0).split(",")]
    elif flag == "--skip":
        skips.append([int(v) for v in args.pop(0).split(",")])
    elif flag == "--mask":
        mask_out = args.pop(0)

img = Image.open(path).convert("RGB")
if crop:
    img = img.crop(crop)
    skips = [[s[0] - crop[0], s[1] - crop[1], s[2] - crop[0], s[3] - crop[1]] for s in skips]
a = np.asarray(img).astype(float) / 255
H, W, _ = a.shape
valid = np.ones((H, W), bool)
for x0, y0, x1, y1 in skips:
    valid[max(0, y0):y1, max(0, x0):x1] = False
r, g, b = a[..., 0], a[..., 1], a[..., 2]
luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
br = b - r
sky_br = np.percentile(br[valid], 90)  # the clearest sky's blue-minus-red
t = np.clip(1 - br / max(sky_br, 1e-3), 0, 1)
cloud = (t > 0.5) & valid
clear = (t < 0.15) & valid
n_valid = valid.sum()
unit = np.sqrt(H * W)

print(f"frame {W}x{H}, clear-sky blue-minus-red {sky_br:.3f}")
print(f"coverage {cloud.sum() / n_valid * 100:.1f}%")
cells = []
for i in range(3):
    for j in range(3):
        sl = (slice(i * H // 3, (i + 1) * H // 3), slice(j * W // 3, (j + 1) * W // 3))
        cells.append(cloud[sl].sum() / max(valid[sl].sum(), 1))
print("coverage by 3x3 cell (rows top to bottom): " + " | ".join(" ".join(f"{c * 100:3.0f}" for c in cells[k:k + 3]) for k in (0, 3, 6)))

lab, n = ndi.label(cloud, structure=np.ones((3, 3)))
areas = ndi.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1)) if n else np.array([])
tiny, real = (areas >= H * W * 0.0003), (areas >= H * W * 0.003)
print(f"clouds: {tiny.sum()} pieces >= 0.03% of frame, {real.sum()} >= 0.3%")
if real.any():
    d = 2 * np.sqrt(areas[real] / np.pi) / unit
    print("  equivalent diameter / sqrt(area): p10 {:.3f}  p50 {:.3f}  p90 {:.3f}  max {:.3f}".format(*np.percentile(d, [10, 50, 90]), d.max()))
    print(f"  biggest cloud holds {areas.max() / areas.sum() * 100:.0f}% of the cloud area")
    crinkle = []
    for k in np.nonzero(real)[0]:
        m = lab == k + 1
        edge = m & ~ndi.binary_erosion(m)
        crinkle.append(edge.sum() ** 2 / (4 * np.pi * m.sum()))
    print(f"  outline crinkliness (1 = disc): median {np.median(crinkle):.1f}")
half = ((t > 0.15) & (t < 0.85) & valid).sum()
print(f"edge softness: {half / max(cloud.sum(), 1):.2f} half-cloud pixels per cloud pixel")


def col(m):
    c = a[m].mean(axis=0)
    return f"({c[0]:.3f}, {c[1]:.3f}, {c[2]:.3f}) luma {0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]:.3f}"


rows = np.arange(H)[:, None].repeat(W, 1)
print(f"clear sky top fifth    {col(clear & (rows < H / 5))}")
print(f"clear sky bottom fifth {col(clear & (rows >= 4 * H / 5))}")
solid = (t > 0.85) & valid
cl = luma[solid]
if cl.size:
    lo, hi = np.percentile(cl, [20, 80])
    print(f"cloud luma p5 {np.percentile(cl, 5):.3f}  p50 {np.median(cl):.3f}  p95 {np.percentile(cl, 95):.3f}  std {cl.std():.3f}")
    print(f"cloud lit (top 20%)     {col(solid & (luma >= hi))}")
    print(f"cloud shaded (low 20%)  {col(solid & (luma <= lo))}")
if mask_out:
    Image.fromarray((np.dstack([t, t, t]) * 255).astype(np.uint8)).save(mask_out)
    print(mask_out)
