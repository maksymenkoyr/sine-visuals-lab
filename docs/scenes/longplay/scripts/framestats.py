"""framestats.py img [img...] — what a frame is made of, to put ours beside a reference frame by number:
the colour of each brightness band (max channel) and its share of pixels, column brightness, and the
horizontal vs vertical fine-detail ratio (x/y > 1: detail runs vertical). Run with
`uv run --with pillow --with numpy python framestats.py a.png b.jpg`. Ignores the top 60 px and bottom
70 px (our UI chrome) on every image so both sides compare alike."""
import sys
from PIL import Image
import numpy as np

for f in sys.argv[1:]:
    im = Image.open(f).convert("RGB")
    if im.size != (1280, 720):
        im = im.resize((1280, 720))
    a = np.asarray(im).astype(float)[60:650] / 255
    l = a.max(2)
    print(f.split("/")[-1], "mean", a.mean((0, 1)).round(3), "maxch", round(l.mean(), 3), "dark<0.05", round((l < 0.05).mean(), 2))
    for lo, hi in [(0.05, 0.15), (0.15, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 1.01)]:
        m = (l >= lo) & (l < hi)
        print("   ", lo, hi, round(m.mean(), 3), a[m].mean(0).round(2) if m.any() else "")
    col = l.mean(0)
    print("   col", [round(col[i * 64:(i + 1) * 64].mean(), 2) for i in range(20)])
    # fine-structure energy: mean abs horizontal vs vertical pixel difference
    gx = np.abs(np.diff(l, axis=1)).mean()
    gy = np.abs(np.diff(l, axis=0)).mean()
    print("   grad x", round(gx, 4), "grad y", round(gy, 4), "x/y", round(gx / max(gy, 1e-6), 2))
