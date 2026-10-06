# /// script
# requires-python = ">=3.11"
# dependencies = ["mpmath>=1.3"]
# ///
"""
Finds deep-dive targets for Fractal Grid: Misiurewicz points, the centres of
the set's spirals, where the picture stays intricate however far you zoom.
A Misiurewicz point M(k, p) is a c whose critical orbit 0 → c → … lands on a
repelling cycle of length p after k steps: f^(k+p)(0) = f^k(0). From a rough
seed (a point by eye in a valley), Newton's method on that equation finds it
to as many digits as asked; the orbit check then confirms the exact (k, p)
so a seed that slid to a different point is caught.

    uv run docs/scenes/fractalgrid/scripts/find_targets.py            # the chosen targets
    uv run docs/scenes/fractalgrid/scripts/find_targets.py --search   # candidates in REGIONS

The default prints SELECTED as motion.ts's DIVE_TARGETS entries: each
coordinate split into a double-double pair (hi + lo, about 32 digits — what
the app's reference orbit is computed in), the iterations a dive costs per
e-fold of zoom, and in a comment the cycle's multiplier λ. Near a
Misiurewicz point the set repeats itself scaled by |λ| and turned by arg λ,
so a straight zoom makes the spiral appear to turn arg λ / ln|λ| per e-fold,
and a pixel there needs about p / ln|λ| more iterations per e-fold to
escape — which is why weak repellers (|λ| near 1, like the seahorse
valley's) are too dear to dive into at frame rate.
"""
from mpmath import mp, mpc, mpf, fabs, log, arg, pi

mp.dps = 80


def orbit(c, n):
    z = mpc(0)
    out = []
    for _ in range(n):
        z = z * z + c
        out.append(z)
    return out


def newton_misiurewicz(seed, k, p, steps=200):
    """Newton on g(c) = f^(k+p)(0) − f^k(0), derivative carried alongside."""
    c = mpc(seed)
    for _ in range(steps):
        z = mpc(0)
        dz = mpc(0)
        zk = dzk = None
        for i in range(1, k + p + 1):
            dz = 2 * z * dz + 1
            z = z * z + c
            if i == k:
                zk, dzk = z, dz
        g = z - zk
        dg = dz - dzk
        if dg == 0:
            break
        step = g / dg
        c -= step
        if fabs(step) < mpf(10) ** (-(mp.dps - 5)):
            break
    return c


def exact_type(c, kmax=40, pmax=8):
    """Smallest (k, p) with f^(k+p)(0) == f^k(0) to working precision."""
    zs = [mpc(0)] + orbit(c, kmax + pmax + 1)
    tol = mpf(10) ** (-(mp.dps - 15))
    for k in range(0, kmax + 1):
        for p in range(1, pmax + 1):
            if fabs(zs[k + p] - zs[k]) < tol:
                return k, p
    return None


def multiplier(c, k, p):
    zs = [mpc(0)] + orbit(c, k + p)
    lam = mpc(1)
    for i in range(k, k + p):
        lam *= 2 * zs[i]
    return lam


# Valleys to search, as (name, centre, half-size): boxes read off the set by
# eye around the spirals deep zooms usually head for.
REGIONS = [
    ("seahorse valley", complex(-0.75, 0.11), 0.05),
    ("elephant valley", complex(0.30, 0.03), 0.05),
    ("triple-spiral valley", complex(-0.09, 0.65), 0.04),
    ("quad valley", complex(0.28, 0.53), 0.04),
    ("period-3 bulb tip", complex(-0.12, 0.95), 0.06),
]


def fast_newton(seed, k, p, steps=60):
    """Double-precision Newton for the search; mpmath refines the winners."""
    c = seed
    for _ in range(steps):
        z = 0j
        dz = 0j
        zk = dzk = 0j
        for i in range(1, k + p + 1):
            dz = 2 * z * dz + 1
            z = z * z + c
            if i == k:
                zk, dzk = z, dz
            if abs(z) > 4:
                return None
        dg = dz - dzk
        if dg == 0:
            return None
        step = (z - zk) / dg
        c -= step
        if abs(step) < 1e-15:
            return c
    return None


def search(rng_seed=7, per_region=40, kmax=14, pmax=3):
    import random

    rnd = random.Random(rng_seed)
    found = []
    for name, centre, half in REGIONS:
        for k in range(3, kmax + 1):
            for p in range(1, pmax + 1):
                for _ in range(per_region):
                    seed = centre + complex(rnd.uniform(-half, half), rnd.uniform(-half, half))
                    c = fast_newton(seed, k, p)
                    if c is None or abs(c - centre) > 1.5 * half:
                        continue
                    if any(abs(c - f[1]) < 1e-9 for f in found):
                        continue
                    found.append((name, c, k, p))
    return found


# (name, k, p, rough re, rough im) — picked from a --search run for a mix of
# slow and fast spins, all cheap per e-fold.
SELECTED = [
    ("elephant valley, slow spin", 11, 3, 0.304514192476304, 0.020036558149490),
    ("seahorse valley, slow reverse spin", 21, 3, -0.777627009906878, 0.137773419669761),
    ("period-3 bulb, dendrite", 9, 3, -0.142332829226246, 0.978586038099813),
    ("elephant valley, upper slow spin", 19, 3, 0.324900972521607, 0.045908570906939),
    ("west seahorse valley, reverse spin", 19, 3, -1.300596281597996, 0.077210361892093),
    ("elephant valley, fast reverse spin", 10, 1, 0.343948935415992, 0.056071829977875),
    ("antenna, flips each repeat", 3, 1, -1.543689012692076, 0.0),
    ("elephant valley, four arms", 7, 4, 0.335988293549086, 0.043908955961225),
    ("west seahorse valley, whirl", 15, 1, -1.294101767071549, 0.080859056867455),
    ("elephant valley, lower slow spin", 11, 3, 0.317745877481411, -0.028768463150400),
    ("period-3 bulb tip, whirl", 4, 1, -0.101096363845622, 0.956286510809142),
    ("elephant valley, outer four arms", 5, 4, 0.373632569281020, 0.085045350153031),
]


def dd(x):
    """Double-double split: hi is the nearest double, lo the next one."""
    hi = float(x)
    lo = float(x - mpf(hi))
    return hi, lo


def print_selected():
    for name, k, p, re0, im0 in SELECTED:
        c = newton_misiurewicz(mpc(re0, im0), k, p)
        assert exact_type(c) == (k, p), name
        lam = multiplier(c, k, p)
        ln = log(fabs(lam))
        spin = arg(lam) * 180 / pi / ln
        reh, rel = dd(c.real)
        imh, iml = dd(c.imag)
        print(f"  // {name}: M({k},{p}), |λ| {mp.nstr(fabs(lam), 4)}, turns {mp.nstr(spin, 3)}° per e-fold")
        print(f"  deepTarget({reh!r}, {rel!r}, {imh!r}, {iml!r}, {float(p / ln):.3f}),")


def main():
    import sys

    if "--search" not in sys.argv:
        print_selected()
        return
    for name, c0, k, p in search():
        c = newton_misiurewicz(mpc(c0.real, c0.imag), k, p)
        t = exact_type(c)
        if t != (k, p):
            continue
        lam = multiplier(c, k, p)
        if fabs(lam) < 1.05:
            continue
        print(
            f"# {name}: M({k},{p})  |λ| {mp.nstr(fabs(lam), 5)}  turn {mp.nstr(arg(lam) * 180 / pi, 5)}°"
            f"  ln|λ| {mp.nstr(log(fabs(lam)), 4)}"
        )
        print(f'  {{ re: "{mp.nstr(c.real, 60, strip_zeros=False)}", im: "{mp.nstr(c.imag, 60, strip_zeros=False)}" }},')


if __name__ == "__main__":
    main()
