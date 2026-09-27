"""Sky: solves one day key's zenith and horizon for target on-screen colours.

The display shader trims the sky after the keys (SKY_SPREAD pulls chroma
toward the gradient's mid colour at constant luma, SKY_LEVEL dims), so a key
written as the colour you want comes out duller and darker. This inverts
that at the top edge (pure zenith) and the bottom edge (almost pure horizon;
the gradient is smoothstep(SKY_GRADIENT_LO, SKY_GRADIENT_HI, uv.y)), sun glow
ignored, by fixed-point iteration.

usage: python3 solve_key.py "zr,zg,zb" "hr,hg,hb" [spread] [level] [lo] [hi]
       (target top and bottom colours, 0..1)
Written 2026-09-27 for the "darkest it gets" key.
"""
import sys

T = [float(v) for v in sys.argv[1].split(",")]
B = [float(v) for v in sys.argv[2].split(",")]
spread = float(sys.argv[3]) if len(sys.argv) > 3 else 0.6
level = float(sys.argv[4]) if len(sys.argv) > 4 else 0.86
lo = float(sys.argv[5]) if len(sys.argv) > 5 else -0.1
hi = float(sys.argv[6]) if len(sys.argv) > 6 else 0.9


def luma(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def render(Z, H, y):
    t = smooth(lo, hi, y)
    col = [H[i] + (Z[i] - H[i]) * t for i in range(3)]
    mid = [(Z[i] + H[i]) / 2 for i in range(3)]
    mc = [v / max(luma(mid), 1e-3) for v in mid]
    L = max(luma(col), 1e-3)
    return [L * (mc[i] + (col[i] / L - mc[i]) * spread) * level for i in range(3)]


Z = [v / level for v in T]
H = [v / level for v in B]
for _ in range(200):
    top, bot = render(Z, H, 1.0), render(Z, H, 0.0)
    Z = [Z[i] + (T[i] - top[i]) / level for i in range(3)]
    H = [H[i] + (B[i] - bot[i]) / level for i in range(3)]
fmt = lambda c: "(" + ", ".join(f"{v:.3f}" for v in c) + ")"
print("zenith key ", fmt(Z))
print("horizon key", fmt(H))
for y in (1.0, 0.75, 0.5, 0.25, 0.0):
    print(f"  y={y:.2f} renders {fmt(render(Z, H, y))}")
