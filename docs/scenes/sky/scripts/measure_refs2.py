# Sky: measures two pasted reference stills as structure — for a floaters
# reference, background colour and bright-blob shapes/aspect ratios (are they
# squiggles or rings?); for a dramatic-cumulus reference, sky/highlight/
# shadow/mid-tone RGB and hue, lum percentiles, and internal-contrast/
# gradient sharpness. Printed numbers, not an impression, to build a scene
# to match.
# Rescued from a working session on 2026-09-23.
# usage: python3 measure_refs2.py <floaters.png> <cumulus.png>
# May need adjusting to current code — this is a one-off analysis of two
# specific reference images; adapt the printed measurements to whatever
# you're comparing against.
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy", "scipy"]
# ///
import sys
import numpy as np
from PIL import Image

IMG3 = sys.argv[1]  # floaters reference
IMG5 = sys.argv[2]  # dramatic cumulus reference

def load(path):
    im = Image.open(path).convert("RGB")
    return np.asarray(im).astype(np.float32), im.size

# --- Image 3: floaters, cleaner reference ---
arr, size = load(IMG3)
h, w, _ = arr.shape
print(f"=== Image 3 (floaters): {w}x{h} ===")
r, g, b = arr[...,0], arr[...,1], arr[...,2]
lum = 0.299*r + 0.587*g + 0.114*b
print("background (median) RGB:", np.median(r), np.median(g), np.median(b), " lum median:", np.median(lum))
hsv = np.array(Image.open(IMG3).convert("HSV")).astype(np.float32)
print("background sat (25th pct region, lum<median) mean:", hsv[...,1][lum < np.median(lum)].mean())
bright = lum > np.percentile(lum, 99.3)
from scipy import ndimage
labels, n = ndimage.label(bright)
print("num bright blobs (top 0.7% lum):", n)
objs = ndimage.find_objects(labels)
shapes = []
for i, sl in enumerate(objs):
    if sl is None: continue
    area = (labels[sl] == i+1).sum()
    if area < 8: continue
    bh = sl[0].stop - sl[0].start
    bw = sl[1].stop - sl[1].start
    shapes.append((area, bw, bh, max(bw,bh)/max(1,min(bw,bh))))
shapes.sort(reverse=True)
print("largest shapes (area, w, h, aspect) -- squiggles have high aspect, rings ~1.0:")
for s in shapes[:14]:
    print(" ", s)
print("floater stroke width vs canvas: widest dim %:", [round(100*max(s[1],s[2])/w,2) for s in shapes[:8]])
print("lum contrast: p50/p90/p99:", np.percentile(lum, [50,90,99]))

print()
# --- Image 5: dramatic cumulus ---
arr5, size5 = load(IMG5)
h5, w5, _ = arr5.shape
print(f"=== Image 5 (dramatic cumulus): {w5}x{h5} ===")
r5,g5,b5 = arr5[...,0], arr5[...,1], arr5[...,2]
lum5 = 0.299*r5 + 0.587*g5 + 0.114*b5
print("sky patch (top-right 60x60) RGB:", arr5[:60, -60:].reshape(-1,3).mean(axis=0))
print("brightest highlight (top 1% lum) RGB:", arr5.reshape(-1,3)[lum5.flatten() > np.percentile(lum5,99)].mean(axis=0))
print("darkest shadow (bottom 5% lum) RGB:", arr5.reshape(-1,3)[lum5.flatten() < np.percentile(lum5,5)].mean(axis=0))
print("mid-tone fold (45-55 pct lum) RGB:", arr5.reshape(-1,3)[(lum5.flatten()>np.percentile(lum5,45)) & (lum5.flatten()<np.percentile(lum5,55))].mean(axis=0))
print("lum percentiles 1/25/50/75/99:", np.percentile(lum5, [1,25,50,75,99]))
gy, gx = np.gradient(lum5)
gmag = np.hypot(gx, gy)
print("local internal contrast (std of lum in cloud-only region lum>150):", lum5[lum5>150].std())
print("gradient p50/p90/p99 (edge sharpness incl internal folds):", np.percentile(gmag, [50,90,99]))
hsv5 = np.array(Image.open(IMG5).convert("HSV")).astype(np.float32)
print("hue of highlight vs shadow region (0-255 scale, ~0/255=red, 42=yellow, 85=green, 170=blue):")
print("  highlight hue mean:", hsv5[...,0][lum5>np.percentile(lum5,95)].mean(), "sat:", hsv5[...,1][lum5>np.percentile(lum5,95)].mean())
print("  shadow hue mean:", hsv5[...,0][lum5<np.percentile(lum5,15)].mean(), "sat:", hsv5[...,1][lum5<np.percentile(lum5,15)].mean())
print("  open-sky hue/sat (small patch, top-right):", hsv5[:60,-60:,0].mean(), hsv5[:60,-60:,1].mean())
