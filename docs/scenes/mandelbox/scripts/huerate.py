# How fast the reference's colours turn: the chroma-weighted mean hue of lit, saturated pixels per
# frame (not the hue of the mean colour, which swings wildly when that mean is near grey), unwrapped,
# then its net and total travel and the turn period over windows.
# usage: python huerate.py <frames.npy> <fps>
import sys

import numpy as np

f = np.load(sys.argv[1]).astype(np.float32) / 255
fps = float(sys.argv[2])
n = len(f)
mx, mn = f.max(-1), f.min(-1)
chroma = mx - mn
lum = f @ np.array([0.2126, 0.7152, 0.0722], np.float32)
# hue angle per pixel (hexcone), radians
r, g, b = f[..., 0], f[..., 1], f[..., 2]
ang = np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)
w = np.where((lum > 0.12) & (chroma > 0.12), chroma, 0)
cx = (w * np.cos(ang)).sum((1, 2))
cy = (w * np.sin(ang)).sum((1, 2))
strength = np.hypot(cx, cy) / (w.sum((1, 2)) + 1e-9)  # 1 = one hue, 0 = all hues at once
h = np.unwrap(np.arctan2(cy, cx))
ok = strength > 0.25
print(f"frames {n}, with a clear dominant hue {ok.mean():.2f}")
dh = np.diff(h)
dh = dh[ok[1:] & ok[:-1]]
print(f"net travel {(h[-1] - h[0]) / (2 * np.pi):+.1f} turns; total |travel| {np.abs(dh).sum() / (2 * np.pi):.1f} turns over {n / fps:.0f} s")
win = int(60 * fps)
rates = []
for s0 in range(0, n - win, win):
    seg = slice(s0, s0 + win)
    if ok[seg].mean() < 0.5:
        continue
    t = np.arange(win) / fps
    k = np.polyfit(t[ok[seg]], h[seg][ok[seg]], 1)[0]
    rates.append(k / (2 * np.pi))
rates = np.array(rates)
print(f"per-minute fitted turn rate (turns/s): median {np.median(rates):+.4f}, |median| {np.median(np.abs(rates)):.4f}, "
      f"share of minutes turning the same way as the net {np.mean(np.sign(rates) == np.sign(h[-1] - h[0])):.2f}")
print(f"=> seconds per turn: median over minutes {1 / max(np.median(np.abs(rates)), 1e-6):.0f}; from net travel {n / fps / max(abs(h[-1] - h[0]) / (2 * np.pi), 1e-6):.0f}")
