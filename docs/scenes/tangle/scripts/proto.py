# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "pillow>=10.1", "scipy>=1.11"]
# ///
"""The numpy prototype Tangle was designed from (2026-10-05): a sphere's
position texture warped in its own uv space by a noise offset every step,
the points splatted additively. It checked the mechanism before any GL was
written: patches copy one source and pile onto a knot, and the texels on a
patch border hold blends that lie on the straight chord between knots.

    uv run docs/scenes/tangle/scripts/proto.py OUT.png [--n 256] [--amp 0.004]
        [--freq 3] [--freq2 0] [--amp2 0] [--steps 0,10,30,60,300] [--seed 1]

--amp/--amp2: uv offset per step of the coarse and the fine octave (noise
std 1); --freq/--freq2: their spectral width in cycles across the texture.
OUT gets one tile per entry of --steps. The prototype wraps v across the
poles (a seam the scene fixes by continuing a row past a pole half a turn
round).
"""
import math
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

args = sys.argv[1:]
out = args[0]


def opt(k, d):
    return type(d)(args[args.index(k) + 1]) if k in args else d


N = opt("--n", 256)
AMP = opt("--amp", 0.004)
FREQ = opt("--freq", 3.0)
F2 = opt("--freq2", 0.0)
A2 = opt("--amp2", 0.0)
STEPS = [int(s) for s in opt("--steps", "0,10,30,60,300").split(",")]
SEED = opt("--seed", 1)


def vnoise(shape, freq, seed):
    """Smooth periodic noise: white noise low-passed in Fourier space, std 1."""
    r = np.random.default_rng(seed).standard_normal(shape)
    f = np.fft.fft2(r)
    ky = np.fft.fftfreq(shape[0])[:, None] * shape[0]
    kx = np.fft.fftfreq(shape[1])[None, :] * shape[1]
    k = np.sqrt(kx**2 + ky**2)
    o = np.real(np.fft.ifft2(f * np.exp(-((k / freq) ** 2))))
    return o / o.std()


u = (np.arange(N) + 0.5) / N
U, V = np.meshgrid(u, u)
th, ph = U * 2 * math.pi, V * math.pi
P = np.stack([np.sin(ph) * np.cos(th), np.cos(ph), np.sin(ph) * np.sin(th)], -1)

dx = vnoise((N, N), FREQ, SEED) * AMP * N  # offsets in texels
dy = vnoise((N, N), FREQ, SEED + 7) * AMP * N
if F2:
    dx = dx + vnoise((N, N), F2, SEED + 3) * A2 * N
    dy = dy + vnoise((N, N), F2, SEED + 9) * A2 * N
yy, xx = np.meshgrid(np.arange(N), np.arange(N), indexing="ij")
cy, cx = yy + dy, xx + dx

W = 540


def render(P, ang):
    c, s = math.cos(ang), math.sin(ang)
    x = P[..., 0] * c + P[..., 2] * s
    z = -P[..., 0] * s + P[..., 2] * c
    y = P[..., 1]
    k = 2.6 / (3.2 - z)
    px = (x * k * 0.5 + 0.5) * W
    py = (-y * k * 0.5 + 0.5) * W
    img = np.zeros((W, W))
    ix, iy = px.astype(int).ravel(), py.astype(int).ravel()
    m = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < W)
    np.add.at(img, (iy[m], ix[m]), 1.0)
    img = gaussian_filter(img, 0.7) + gaussian_filter(img, 6) * 1.5
    img = 1 - np.exp(-img * 0.9)
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)


tiles = []
step = 0
for target in STEPS:
    while step < target:
        for ch in range(3):
            P[..., ch] = map_coordinates(P[..., ch], [cy, cx], order=1, mode="wrap")
        step += 1
    tiles.append(render(P, 0.3))
Image.fromarray(np.concatenate(tiles, 1)).save(out)
print("wrote", out)
