# /// script
# dependencies = ["numpy", "pillow"]
# ///
# Palette shares of a frame (centre crop, away from UI): dark / teal / green / bright, mean lum.
import colorsys
import sys

import numpy as np
from PIL import Image

for path in sys.argv[1:]:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    a = np.asarray(im.crop((int(w * 0.1), int(h * 0.12), int(w * 0.9), int(h * 0.88))).resize((320, 180))).astype(float) / 255
    lum = a @ [0.2126, 0.7152, 0.0722]
    hsv = np.array([colorsys.rgb_to_hsv(*px) for px in a.reshape(-1, 3)])
    hue = hsv[:, 0] * 360
    L = lum.ravel()
    dark = L < 0.12
    lit = ~dark
    teal = lit & (hue >= 140)
    green = lit & (hue < 140) & (L < 0.45)
    bright = lit & (hue < 140) & (L >= 0.45)
    print(f"{path.split('/')[-1]:28s} lum {L.mean():.2f}  dark {dark.mean():.2f} teal {teal.mean():.2f} green {green.mean():.2f} bright {bright.mean():.2f}")
