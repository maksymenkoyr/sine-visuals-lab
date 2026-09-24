# Sky: samples "sunNear"/"sunFar" raw density values encoded into a debug
# screenshot's red/green channels (clouds detected via the blue channel =
# cloudAlpha*255), reporting percentiles within cloud pixels.
# Rescued from a working session on 2026-09-23.
# usage: python3 sample_taps.py <screenshot.png>
# May need adjusting to current code — the *0.3 encode and channel meaning
# are tied to a specific debug-visualisation build of the scene.
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
import sys
import numpy as np
from PIL import Image
path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sky-taps-debug-latest.png"
im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
h, w, _ = im.shape
mask = np.ones((h,w), dtype=bool)
mask[:140,:160] = False
cloud = im[...,2] > 60  # blue channel = cloudAlpha*255
cloud &= mask
sunNear = im[...,0][cloud] / 0.3 / 255.0
sunFar = im[...,1][cloud] / 0.3 / 255.0
print("inside cloud (alpha>~0.24) pixel count:", cloud.sum())
print("sunNear (raw density) within cloud: p10/p50/p90/p99:", np.percentile(sunNear, [10,50,90,99]))
print("sunFar  (raw density) within cloud: p10/p50/p90/p99:", np.percentile(sunFar, [10,50,90,99]))
print("max observed (clamped by *0.3 encode, real value could be higher if >~3.33):", sunNear.max(), sunFar.max())
