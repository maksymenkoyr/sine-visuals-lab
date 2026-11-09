# Loop search on a low-res copy: loopsearch.py <ffmpeg> <video> [fps]
# Prints distance-to-frame-0 minima, mean distance by lag (a loop of
# period P shows a deep dip at lag P for every t), and per-minute colour.
import colorsys
import subprocess
import sys

import numpy as np

ff, src = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
W, H = 128, 72
raw = subprocess.run(
    [ff, "-v", "error", "-i", src, "-vf", f"fps={fps},scale={W}:{H}", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
    capture_output=True,
).stdout
n = len(raw) // (W * H * 3)
v = np.frombuffer(raw[: n * W * H * 3], np.uint8).reshape(n, H, W, 3).astype(np.float32)
g = v.mean(axis=3)
print(f"frames {n} at {fps} fps = {n / fps:.1f} s")

flat = g.reshape(n, -1)
flat = (flat - flat.mean(1, keepdims=True)) / (flat.std(1, keepdims=True) + 1e-6)


def corr(a, b):
    return float((flat[a] * flat[b]).mean())


# correlation of every frame with frame 0 (and with a frame mid-way)
for ref in (0, n // 2):
    c = (flat @ flat[ref]) / flat.shape[1]
    c[max(0, ref - int(5 * fps)): ref + int(5 * fps)] = -9
    top = np.argsort(-c)[:8]
    print(f"best matches to frame at {ref / fps:.1f}s:", ", ".join(f"{i / fps:.1f}s r{c[i]:.3f}" for i in top))

# mean correlation at short lags: how fast the picture decorrelates
for lag_s in (0.5, 1, 2, 3, 5, 8, 12, 20, 30, 60, 120):
    L = int(round(lag_s * fps))
    if L >= n:
        break
    idx = np.arange(0, n - L, max(1, (n - L) // 400))
    r = np.mean([corr(i, i + L) for i in idx])
    print(f"lag {lag_s:>5}s  mean r {r:.3f}")

# long-lag scan for a loop: mean r between t and t+L over a sample of t
best = []
idx0 = np.arange(0, n, max(1, n // 300))
for L in range(int(10 * fps), n // 2):
    idx = idx0[idx0 + L < n]
    r = float(np.mean(np.sum(flat[idx] * flat[idx + L], axis=1) / flat.shape[1]))
    best.append((r, L / fps))
best.sort(reverse=True)
print("best long lags:", ", ".join(f"{s:.1f}s r{r:.3f}" for r, s in best[:10]))

# per-minute colour: mean luma, mean saturation, hue share of lit pixels
print("minute  luma  lit%  hue-shares(red/mag/viol/other)")
per = int(60 * fps)
for m in range(0, n, per):
    blk = v[m: m + per: max(1, per // 20)] / 255.0
    lum = blk.mean()
    px = blk.reshape(-1, 3)
    mx = px.max(1)
    lit = px[mx > 0.25]
    hs = np.array([colorsys.rgb_to_hsv(*p)[0] * 360 for p in lit[:: max(1, len(lit) // 3000)]])
    red = np.mean((hs < 15) | (hs >= 345))
    mag = np.mean((hs >= 300) & (hs < 345))
    vio = np.mean((hs >= 250) & (hs < 300))
    print(f"{m / per:5.0f}  {lum:.3f}  {len(lit) / len(px) * 100:4.1f}  {red:.2f}/{mag:.2f}/{vio:.2f}/{1 - red - mag - vio:.2f}")
