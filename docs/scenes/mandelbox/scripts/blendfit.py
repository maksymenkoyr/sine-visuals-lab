# Two models of a mirror run's ramp, fitted frame by frame (grey, given width):
# - fade: a mirror effect faded in or out over a still clip, R_t = a*flip(L_t) + b*R_ref (and the halves
#   swapped), with R_ref the half at <ref_t>, a moment outside the mirrored state;
# - blend: a plain dissolve between the frames at <tA> and <tB>, F_t = a*F_A + b*F_B.
# A true fade or dissolve keeps R2 near 1 all the way through. On the reference both fall to 0.1-0.5
# halfway: the clips keep moving through their dissolves, so a ramp's frames are no mix of its end frames.
# usage: blendfit.py <video> <fps> <t0> <dur> <tA> <tB> <ref_t> [width]
import sys

import numpy as np

from vidio import load

src, fps, t0, dur, tA, tB, t_ref = sys.argv[1], float(sys.argv[2]), *map(float, sys.argv[3:8])
width = int(sys.argv[8]) if len(sys.argv) > 8 else 426
f = load(src, t0, dur, fps, width).astype(np.float64) / 255
n, h, w = f.shape
iA, iB, iR = (int(round((t - t0) * fps)) for t in (tA, tB, t_ref))
half = w // 2
L, R = f[:, :, :half], f[:, :, w - half:]


def fit(y, *xs):
    A = np.stack([x.ravel() for x in xs] + [np.ones(y.size)], 1)
    coef, *_ = np.linalg.lstsq(A, y.ravel(), rcond=None)
    res = y.ravel() - A @ coef
    return coef, 1 - res.var() / (y.var() + 1e-12)


def lr(im):
    a = im - im.mean()
    return (a * a[:, ::-1]).sum() / ((a * a).sum() + 1e-12)


print(f"{t0}+{dur}s, A={tA}s B={tB}s, fade reference {t_ref}s, {w}x{h}")
print("    t      LR   | fade L->R: a   b   R2 | fade R->L: a   b   R2 | blend: a(A) b(B)  R2 | R2 nearest end alone")
for i in range(0, n, max(1, n // 30)):
    (a1, b1, _), r1 = fit(R[i], L[i][:, ::-1], R[iR])
    (a2, b2, _), r2 = fit(L[i], R[i][:, ::-1], L[iR])
    (a3, b3, _), r3 = fit(f[i], f[iA], f[iB])
    _, rA = fit(f[i], f[iA])
    _, rB = fit(f[i], f[iB])
    print(f"{t0 + i / fps:8.2f} {lr(f[i]):+.3f} | {a1:+.2f} {b1:+.2f} {r1:.2f} | {a2:+.2f} {b2:+.2f} {r2:.2f} | "
          f"{a3:+.2f} {b3:+.2f} {r3:.2f} | {max(rA, rB):.2f}")
