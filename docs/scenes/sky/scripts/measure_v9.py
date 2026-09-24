# Sky: brightness/cloud stats from a screenshot — luminance percentiles,
# cloud-pixel fraction and internal contrast, and shadow/highlight RGB
# proxies, for comparing a render against reference targets by number.
# Rescued from a working session on 2026-09-23.
# usage: python3 measure_v9.py <screenshot.png>
# May need adjusting to current code — the top-left UI-chrome mask (140x160)
# assumes a specific panel layout.
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
import sys
import numpy as np
from PIL import Image
path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sky-v10-latest.png"
im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
h, w, _ = im.shape
mask = np.ones((h,w), dtype=bool)
mask[:140,:160] = False
lum = 0.299*im[...,0]+0.587*im[...,1]+0.114*im[...,2]
cloudish = (lum > 200) & mask
print("cloud (lum>200) internal std:", lum[cloudish].std(), " count frac:", cloudish.mean()*100)
print("overall lum p1/p25/p50/p75/p99:", np.percentile(lum[mask], [1,25,50,75,99]))
print("open-sky patch (top-right 60x60) RGB:", im[:60,-60:].reshape(-1,3).mean(axis=0))
# reference targets: image5 lum p1=150, cloud-internal std~24, shadow RGB~(156,151,172), highlight~(255,255,254)
darkest_patch = im[mask][lum[mask] < np.percentile(lum[mask],10)]
print("darkest 10pct RGB (shadow tone proxy):", darkest_patch.mean(axis=0))
brightest_patch = im[mask][lum[mask] > np.percentile(lum[mask],99)]
print("brightest 1pct RGB (highlight tone proxy):", brightest_patch.mean(axis=0))
