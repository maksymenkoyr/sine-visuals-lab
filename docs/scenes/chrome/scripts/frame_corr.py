# /// script
# dependencies = ["numpy", "pillow"]
# ///
# Frame-vs-frame correlation (grey, 160x90, centre crop) between consecutive shots, and vs the first.
import sys

import numpy as np
from PIL import Image


def load(p):
    im = Image.open(p).convert("L")
    w, h = im.size
    a = np.asarray(im.crop((int(w * 0.1), int(h * 0.12), int(w * 0.9), int(h * 0.88))).resize((160, 90))).astype(float)
    a -= a.mean()
    return a / a.std()


F = [load(p) for p in sys.argv[1:]]
for i in range(1, len(F)):
    print(f"shot {i}: vs prev {np.mean(F[i] * F[i - 1]):.3f}  vs first {np.mean(F[i] * F[0]):.3f}")
