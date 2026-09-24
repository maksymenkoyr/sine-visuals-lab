# Sky: finds the brightest pixel outside the UI chrome in one or more
# screenshots and reports a patch mean RGB there, plus overall luminance
# percentiles and bright-pixel fractions.
# Rescued from a working session on 2026-09-23.
# usage: python3 sample_px2.py <screenshot.png> [more.png ...]
# May need adjusting to current code — the top-left UI-chrome mask (140x160)
# assumes a specific panel layout.
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
import sys
import numpy as np
from PIL import Image

paths = sys.argv[1:] or ["/tmp/sky-debug-latest.png", "/tmp/sky-v3-latest.png"]
for path in paths:
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w, _ = im.shape
    lum = 0.299*im[...,0] + 0.587*im[...,1] + 0.114*im[...,2]
    # exclude the top-left UI chrome (gallery button / clip buffer checkbox)
    mask = np.ones_like(lum, dtype=bool)
    mask[:140, :160] = False
    lum_masked = np.where(mask, lum, -1)
    y, x = np.unravel_index(np.argmax(lum_masked), lum.shape)
    patch = im[max(0,y-10):y+10, max(0,x-10):x+10].reshape(-1,3)
    print(f"=== {path} ===")
    print(f"  brightest pixel at ({x},{y}), patch mean RGB = {patch.mean(axis=0).round(1)}")
    print(f"  overall lum p5/p50/p90/p99: {np.percentile(lum,[5,50,90,99]).round(1)}")
    print(f"  frac lum>200: {(lum>200).mean()*100:.2f}%   frac lum>150: {(lum>150).mean()*100:.2f}%")
