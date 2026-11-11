# Left-right mirror correlation of still images about their vertical centre line, at full size and at
# 64x36 (hour2.py's scale): 1.0000 at full size means mirrored to the pixel (mbx-lab.html?exact places do;
# a decoded video frame can't, its compression caps it near 0.99).
# usage: lrcorr.py <img...>
import sys

import numpy as np
from PIL import Image


def lr(a):
    a = a - a.mean()
    return (a * a[:, ::-1]).sum() / ((a * a).sum() + 1e-12)


for p in sys.argv[1:]:
    im = Image.open(p).convert("L")
    print(f"{p.split('/')[-1]:<24} full {lr(np.asarray(im, np.float64)):+.4f}  64x36 {lr(np.asarray(im.resize((64, 36), Image.BOX), np.float64)):+.4f}")
