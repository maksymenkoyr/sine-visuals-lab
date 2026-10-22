# Mean frame-to-frame correlation at lags of 1..6 beats (0.5 s each on the
# placeholder 120 bpm grid) over files named b<idx>_..._+000.*, at 160x90 grey.
import re
import sys
import numpy as np
from PIL import Image

def load(paths):
    fr = {}
    for p in paths:
        m = re.search(r"b(\d+)_r\d+_\+0+\.", p)
        if m:
            a = np.asarray(Image.open(p).convert("L").resize((160, 90), Image.BILINEAR)).astype(np.float32)
            fr[int(m.group(1))] = (a - a.mean()).ravel()
    return fr

for name, d in zip(sys.argv[1::2], sys.argv[2::2]):
    import glob
    fr = load(glob.glob(d + "/b*_+0*.*"))
    row = []
    for lag in range(1, 7):
        cs = [float(fr[i] @ fr[i + lag] / np.sqrt((fr[i] @ fr[i]) * (fr[i + lag] @ fr[i + lag]))) for i in fr if i + lag in fr]
        row.append(f"{lag * 0.5:.1f}s {np.mean(cs):.2f} (n{len(cs)})" if cs else f"{lag * 0.5:.1f}s -")
    print(name, " | ".join(row))
