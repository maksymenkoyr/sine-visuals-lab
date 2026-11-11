# How the reference's colour turns minute by minute: huerate.py's hue (chroma-weighted, lit coloured pixels)
# from decode.py's 5 fps stack, unwrapped, then each minute's net travel in turns. The hour's net turn rate
# comes from a few fast-cycling clips, not from steady drift. With --jumps, the hue change across given
# changes of look, beyond the drift of the 5 s before, against random 2 s spans.
# usage: huemin.py <hour128.npy> [--jumps <start,end> ...]
import sys

import numpy as np

FPS = 5
f = np.load(sys.argv[1], mmap_mode="r")
n = min(len(f), 3600 * FPS)
hs = []
for s in range(0, n, 600):
    ff = np.asarray(f[s:min(s + 600, n)], np.float32) / 255
    chroma = ff.max(-1) - ff.min(-1)
    lum = ff @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    r, g, b = ff[..., 0], ff[..., 1], ff[..., 2]
    ang = np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)
    w = np.where((lum > 0.12) & (chroma > 0.12), chroma, 0)
    hs.append(np.arctan2((w * np.sin(ang)).sum((1, 2)), (w * np.cos(ang)).sum((1, 2))))
h = np.unwrap(np.concatenate(hs)) / (2 * np.pi)
per_min = np.array([h[min((m + 1) * 60 * FPS, n - 1)] - h[m * 60 * FPS] for m in range(n // (60 * FPS))])
a = np.abs(per_min)
top = np.sort(a)[::-1]
print(f"net travel {h[n - 1] - h[0]:+.1f} turns; per minute: " + " ".join(f"{v:+.1f}" for v in per_min))
print(f"|turns| per minute: median {np.median(a):.2f}, mean {a.mean():.2f}; the fastest 10 minutes hold {top[:10].sum():.1f} of {a.sum():.1f}")

if "--jumps" in sys.argv:
    def mean_hue(t0, t1):
        s = h[int(t0 * FPS):int(t1 * FPS)]
        return np.angle(np.exp(2j * np.pi * s).mean()) / (2 * np.pi)

    def beyond_drift(t0, t1):
        rate = (h[int((t0 - 1) * FPS)] - h[int((t0 - 6) * FPS)]) / 5
        d = (mean_hue(t1, t1 + 1) - mean_hue(t0 - 1, t0) + 0.5) % 1 - 0.5
        return abs(d - rate * (t1 - t0 + 1))

    spans = [tuple(map(float, x.split(","))) for x in sys.argv[sys.argv.index("--jumps") + 1:]]
    j = np.array([beyond_drift(a0, a1) for a0, a1 in spans])
    rng = np.random.default_rng(1)
    null = np.array([beyond_drift(t, t + 2) for t in rng.uniform(30, n / FPS - 10, 400)])
    print(f"hue jump beyond drift across {len(j)} changes: median {np.median(j):.3f} turns (share over 0.15: {np.mean(j > 0.15):.2f}); "
          f"random 2 s spans: median {np.median(null):.3f} (share over 0.15: {np.mean(null > 0.15):.2f})")
