# Blue-channel percentiles + spatial autocorrelation of a set of frames, at 640x360.
import sys
import numpy as np
from PIL import Image

def stats(paths):
    pcts, ac = [], []
    for p in paths:
        im = Image.open(p).convert("RGB").resize((640, 360), Image.BILINEAR)
        a = np.asarray(im).astype(np.float32) / 255
        b = a[..., 2]
        pcts.append(np.percentile(b, [5, 25, 50, 75, 95]))
        x = b - b.mean()
        A = np.fft.ifft2(np.abs(np.fft.fft2(x)) ** 2).real
        A /= A[0, 0]
        ac.append([(A[0, r] + A[r, 0]) / 2 for r in (2, 4, 8, 16, 32, 64, 128)])
        rg = a[..., :2].mean()
    print("  B pct 5/25/50/75/95:", np.mean(pcts, 0).round(3), " RG mean", round(float(rg), 4))
    print("  autocorr r=2,4,8,16,32,64,128:", np.mean(ac, 0).round(3))
    lo = np.mean([(np.asarray(Image.open(p).convert("RGB"))[..., 2] < 38).mean() for p in paths])
    print("  share B<0.15:", round(float(lo), 3))

groups, cur = {}, None
for a in sys.argv[1:]:
    if a.startswith("@"):
        cur = a[1:]
        groups[cur] = []
    else:
        groups[cur].append(a)
for k, v in groups.items():
    print(k, len(v), "frames")
    stats(v)
