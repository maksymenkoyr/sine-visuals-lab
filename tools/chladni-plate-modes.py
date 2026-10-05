#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "scipy>=1.11"]
# ///
"""
chladni-plate-modes: the figure tables for Chladni's polygon plates, written
to src/render/scenes/chladniPlateModes.ts.

    uv run tools/chladni-plate-modes.py
    uvx --with numpy --with scipy python tools/chladni-plate-modes.py   (same)
    ... --check     only print the checks, write nothing
    ... --check hexagon     the same for the named shapes only

numpy and scipy are tooling only (BSD); nothing from them is bundled, the
client reads the plain numbers this writes.

What a figure is. No closed form exists for a free hexagonal or decagonal
plate, so these plates use the free-edge membrane instead, the usual stand-in
where no plate solution exists: a mode f with laplacian(f) = -k^2 f inside
and zero slope across every edge (Neumann). Its frequency is taken as k^2,
as a plate's would be.

The square's scale. Every table is on the square's scale: ratio =
(k / K_FUNDAMENTAL)^2, K_FUNDAMENTAL being the square's (1, 2) mode, so the
ratios feed createPlateResponse exactly as the square's (n^2 + m^2) /
FUNDAMENTAL_ORDER do and a figure at a given ratio has the same line spacing
on every plate. A table covers the square's own range, RATIO_MIN up to its
top pair (K_TOP), and keeps FIGURES of the even figures there, spread evenly
(spread()). The round plate is a true free plate and is solved in the client
(chladniPlates.ts), on the same scale.

The triangle (equilateral, apex up) has a closed form, Lame's: reflecting the
triangle across its edges tiles the plane, a Neumann mode extends to the whole
tiling as an even function, so it is periodic on the tiling's translation
lattice and unchanged by the six-element reflection group at a corner. Such
functions are sums of plane waves, F_k(p) = sum over that group w of
exp(i (w k) . (p - apex)), for k on the dual lattice; Re F_k and Im F_k are
eigenfunctions with k^2 = |k|^2. Each eigenvalue's span is split here by the
plate's symmetry (the vertical mirror and the 120-degree turn), see pick().

The hexagon and decagon (flat top and bottom, circumradius 1) are solved by
the method of particular solutions: f = sum_j a_j J_nu_j(k r) cs(nu_j theta),
theta from the vertical, which meets the equation exactly for any a and k;
k is where some a also meets the edge condition. One series per symmetry
class of the polygon's group: harmonics nu = +-p (mod N), cos (even about
the vertical) or sin (odd). For a class with 0 < p < N/2 the cos and sin
series are one degenerate pair, and only the cos one (whose figure is
mirror-symmetric about the vertical) becomes a figure. For each k the
boundary rows (edge slope) and interior rows (values, so a = 0 can't pass)
are QR-factorised; the smallest singular value of the boundary block of Q
dips to ~0 at an eigenvalue (the subspace-angle form of the method), and its
singular vector gives a. Each class scans its own sigma(k) on a SCAN_STEP
grid and refines every dip (scan_class), so each class finds each of its
eigenvalues once and no two classes can claim the same one. Too many
harmonics for the k make sigma dip to ~0 everywhere, too few leave real
dips shallow; NU_MAX is what was measured to work up to K_TOP.

Only figures even about the vertical are written (pick_even): the plate
shows a blend of figures, and a blend of even ones stays mirror-symmetric.

Every eigenvalue is checked against a second method: a P1 finite-element
solve of the same membrane on two meshes, Richardson-extrapolated (on the
triangle, against Lame's exact values, it is within 2e-4 of k up to K_TOP).
The two spectra, cut at a gap just past K_TOP, must hold the same number of
eigenvalues and agree to K_AGREE. A mode whose edge slope is not small next
to its slope inside fails the run too.
"""

import math
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

# One BLAS thread per process: the scans run one class per process.
for _var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(_var, "1")

import numpy as np
from scipy import ndimage, special
from scipy.linalg import qr, solve_triangular, svd
from scipy.optimize import minimize_scalar
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import eigsh
from scipy.spatial import Delaunay

OUT = Path(__file__).resolve().parent.parent / "src/render/scenes/chladniPlateModes.ts"

# The square's scale, kept in step with chladniPlates.ts (its tests check
# every written ratio against these): FUNDAMENTAL_ORDER is n^2 + m^2 of the
# square's (1, 2) mode, MAX_ORDER its highest order, so its top pair is
# (MAX_ORDER - 1, MAX_ORDER). A square mode's k is pi sqrt(n^2 + m^2).
FUNDAMENTAL_ORDER = 5
MAX_ORDER = 9
K_FUNDAMENTAL = math.pi * math.sqrt(FUNDAMENTAL_ORDER)
K_TOP = math.pi * math.hypot(MAX_ORDER - 1, MAX_ORDER)
# A table's lowest ratio and its figure count: PLATE_RATIO_MIN and
# PLATE_FIGURES in chladniPlates.ts.
RATIO_MIN = 0.8
FIGURES = 36
# Harmonics per series (see the header), and the scan that finds each class's
# eigenvalues: grid step in k, and how deep a refined dip must be to count.
NU_MAX = {"hexagon": 100, "decagon": 180}
SCAN_STEP = 0.01
DIP_MAX = 0.25
# A series column (one harmonic over the sample points) smaller than this has
# underflowed and is left out of that k's system (Mps.system).
COLUMN_FLOOR = 1e-200
# A mode passes when its edge slope (RMS) is below this share of its slope
# inside, and its k agrees with the finite-element solve to this fraction.
RESIDUAL_MAX = 0.03
K_AGREE = 0.004
# When the counts differ, eigenvalues closer than this are shown as a pair.
MATCH_SHOW = 5e-4
# A series term or plane wave smaller than this share of the mode's peak is
# dropped from the table.
PRUNE_SHARE = 1e-7


class Polygon:
    """A regular polygon. Angles run from +y toward +x (theta = 0 is up), so a
    point is centre + r (sin theta, cos theta). `turn` is the angle of the
    first edge's outward normal."""

    def __init__(self, sides, circumradius, cy, turn):
        self.n = sides
        self.R = circumradius
        self.c = np.array([0.0, cy])
        self.turn = turn
        self.apothem = circumradius * math.cos(math.pi / sides)
        th = turn + 2 * math.pi * np.arange(sides) / sides
        self.normals = np.stack([np.sin(th), np.cos(th)], 1)
        tv = th + math.pi / sides
        self.vertices = self.c + circumradius * np.stack([np.sin(tv), np.cos(tv)], 1)

    def gauge(self, x, y):
        q = np.stack([x - self.c[0], y - self.c[1]], -1)
        return np.max(q @ self.normals.T, axis=-1) / self.apothem

    def edges(self):
        # Edge i joins vertex i-1 and vertex i (vertices sit at turn + pi/N + ...).
        for i in range(self.n):
            yield self.vertices[i - 1], self.vertices[i], self.normals[i]

    def random_inside(self, count, rng, half=False):
        out = []
        while len(out) < count:
            p = rng.uniform(-1, 1, size=(count, 2))
            ok = self.gauge(p[:, 0], p[:, 1]) < 0.98
            if half:
                ok &= p[:, 0] >= 0
            out.extend(p[ok])
        return np.array(out[:count])


    def area(self):
        return 0.5 * self.n * self.R**2 * math.sin(2 * math.pi / self.n)

    def perimeter(self):
        return 2 * self.n * self.R * math.sin(math.pi / self.n)


HEXAGON = Polygon(6, 1.0, 0.0, 0.0)
DECAGON = Polygon(10, 1.0, 0.0, 0.0)
TRIANGLE = Polygon(3, 2 / math.sqrt(3), -1 / (2 * math.sqrt(3)), math.pi)
POLYGONS = {"hexagon": HEXAGON, "decagon": DECAGON, "triangle": TRIANGLE}


# ---- Second method: P1 finite elements -------------------------------------


def fem_eigenvalues(poly, h, count):
    pts = []
    for a, b, _ in poly.edges():
        n = max(2, math.ceil(np.linalg.norm(b - a) / h))
        for j in range(n):
            pts.append(a + (b - a) * j / n)
    xs = np.arange(-1.2, 1.2, h)
    ys = np.arange(-1.2, 1.2, h * math.sqrt(3) / 2)
    gx, gy = np.meshgrid(xs, ys)
    gx = gx + (np.arange(len(ys))[:, None] % 2) * h / 2
    gx, gy = gx.ravel(), gy.ravel()
    keep = poly.apothem * (1 - poly.gauge(gx, gy)) > 0.45 * h
    P = np.concatenate([np.array(pts), np.stack([gx[keep], gy[keep]], 1)])
    T = Delaunay(P).simplices
    p0, p1, p2 = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    area = 0.5 * np.abs((p1[:, 0] - p0[:, 0]) * (p2[:, 1] - p0[:, 1]) - (p1[:, 1] - p0[:, 1]) * (p2[:, 0] - p0[:, 0]))
    ok = area > 1e-12
    T, p0, p1, p2, area = T[ok], p0[ok], p1[ok], p2[ok], area[ok]
    b = np.stack([p1[:, 1] - p2[:, 1], p2[:, 1] - p0[:, 1], p0[:, 1] - p1[:, 1]], 1)
    c = np.stack([p2[:, 0] - p1[:, 0], p0[:, 0] - p2[:, 0], p1[:, 0] - p0[:, 0]], 1)
    ke = (b[:, :, None] * b[:, None, :] + c[:, :, None] * c[:, None, :]) / (4 * area[:, None, None])
    me = area[:, None, None] / 12 * (1 + np.eye(3))[None]
    rows = np.repeat(T, 3, axis=1).ravel()
    cols = np.tile(T, (1, 3)).ravel()
    K = coo_matrix((ke.ravel(), (rows, cols)), shape=(len(P), len(P))).tocsc()
    M = coo_matrix((me.ravel(), (rows, cols)), shape=(len(P), len(P))).tocsc()
    # A fixed start vector, so a rerun writes the same table.
    vals = eigsh(K, k=count, M=M, sigma=-1.0, which="LM", v0=np.ones(len(P)), return_eigenvectors=False)
    return np.sort(vals), len(P)


def fem_reference(poly, count, h=0.012):
    """Eigenvalues on two meshes, extrapolated (P1 error goes as h^2)."""
    coarse, n1 = fem_eigenvalues(poly, h, count)
    fine, n2 = fem_eigenvalues(poly, h / math.sqrt(2), count)
    return 2 * fine - coarse, (n1, n2)


def fem_wave_numbers(poly, k_max):
    """Every finite-element wave number up to at least k_max, the constant
    mode dropped. How many to ask for comes from Weyl's law for a Neumann
    membrane, N(k) ~ (area k^2 + perimeter k) / (4 pi), with a margin."""
    count = int(1.15 * (poly.area() * k_max**2 + poly.perimeter() * k_max) / (4 * math.pi)) + 12
    ref, nodes = fem_reference(poly, count)
    k = np.sqrt(np.maximum(ref[1:], 0))
    assert k[-1] > k_max, f"finite elements stop at k {k[-1]:.3f}, below {k_max:.3f}"
    return k, nodes


def cut_past(values, k):
    """A cut just past k, in the widest gap that opens after one of `values`
    (the finite-element spectrum) within half a percent above k: the two
    spectra agree far better than such a gap, so cut there they hold the
    same eigenvalues."""
    v = np.sort(values)
    best, cut = -1.0, k * 1.0025
    for i in range(len(v) - 1):
        if k <= v[i] <= k * 1.005 and v[i + 1] - v[i] > best:
            best, cut = v[i + 1] - v[i], float((v[i] + v[i + 1]) / 2)
    return cut


# ---- Hexagon and decagon: particular solutions -----------------------------


def class_list(n):
    """(p, kind, multiplicity) for every symmetry class of the N-gon's group."""
    out = [(0, "cos", 1), (0, "sin", 1)]
    for p in range(1, (n + 1) // 2):
        if 2 * p != n:
            out.append((p, "cos", 2))
    if n % 2 == 0:
        out += [(n // 2, "cos", 1), (n // 2, "sin", 1)]
    return out


def class_nus(n, p, kind, nu_max):
    nus = [nu for nu in range(nu_max + 1) if nu % n in (p % n, (-p) % n)]
    return [nu for nu in nus if nu > 0] if kind == "sin" else nus


def series_terms(k, nus, kind, x, y):
    """f, df/dx, df/dy of every term J_nu(k r) cs(nu theta) at the points."""
    nus = np.asarray(nus, float)
    r = np.hypot(x, y)
    th = np.arctan2(x, y)
    kr = k * r[:, None]
    J = special.jv(nus[None], kr)
    Jp = k * special.jvp(nus[None], kr)
    if kind == "cos":
        ang, dang = np.cos(nus * th[:, None]), -nus * np.sin(nus * th[:, None])
    else:
        ang, dang = np.sin(nus * th[:, None]), nus * np.cos(nus * th[:, None])
    f = J * ang
    fr = Jp * ang
    fth = J * dang
    rs = np.maximum(r, 1e-12)[:, None]
    s, c = np.sin(th)[:, None], np.cos(th)[:, None]
    return f, fr * s + fth / rs * c, fr * c - fth / rs * s


def edge_points(poly, per_edge, half, cluster=False):
    """Points along every edge (corners excluded) and the edge's normal there.
    Evenly spaced by default; `cluster` packs them toward the corners."""
    pts, nrm = [], []
    j = np.arange(per_edge) + 0.5
    t = (1 - np.cos(np.pi * j / per_edge)) / 2 if cluster else j / per_edge
    for a, b, n in poly.edges():
        for tt in t:
            p = a + (b - a) * tt
            if half and p[0] < -1e-9:
                continue
            pts.append(p)
            nrm.append(n)
    return np.array(pts), np.array(nrm)


class Mps:
    def __init__(self, poly, p, kind, nu_max):
        self.poly, self.kind = poly, kind
        self.nus = class_nus(poly.n, p, kind, nu_max)
        m = len(self.nus)
        self.bp, self.bn = edge_points(poly, max(40, (4 * m) // max(1, poly.n // 2) + 8), half=True)
        self.ip = poly.random_inside(2 * m + 20, np.random.default_rng(1729 + 31 * p), half=True)

    def system(self, k):
        _, gx, gy = series_terms(k, self.nus, self.kind, self.bp[:, 0], self.bp[:, 1])
        ab = gx * self.bn[:, :1] + gy * self.bn[:, 1:]
        ai, _, _ = series_terms(k, self.nus, self.kind, self.ip[:, 0], self.ip[:, 1])
        a = np.vstack([ab, ai])
        scale = np.linalg.norm(a, axis=0)
        # A harmonic far above k r underflows to nothing at small k: such a
        # column carries no information, and left in it would let QR invent
        # a direction for it (a false dip), so it is left out.
        keep = scale > COLUMN_FLOOR
        return a[:, keep] / scale[keep], scale, keep, len(ab)

    def sigmas(self, k):
        """Every singular value of the boundary block, smallest first."""
        a, _, _, nb = self.system(k)
        q, _ = qr(a, mode="economic")
        return svd(q[:nb], compute_uv=False)[::-1]

    def sigma(self, k):
        return self.sigmas(k)[0]

    def coefficients(self, k, which=0):
        """The series of the `which`-th smallest singular value (0 = the
        eigenfunction; 1 the second one when the class holds the eigenvalue
        twice)."""
        a, scale, keep, nb = self.system(k)
        q, r = qr(a, mode="economic")
        _, _, vt = svd(q[:nb])
        coefs = np.zeros(len(scale))
        coefs[keep] = solve_triangular(r, vt[-1 - which]) / scale[keep]
        return coefs


def series_eval(k, nus, kind, coefs, x, y):
    f, gx, gy = series_terms(k, nus, kind, x, y)
    return f @ coefs, gx @ coefs, gy @ coefs


def scan_class(args):
    """One symmetry class's eigenvalues up to k_top: every local minimum of
    sigma on the SCAN_STEP grid, refined, kept when deeper than DIP_MAX. A
    refined dip that lands on one already found is the same eigenvalue. A
    class can hold one eigenvalue twice (the hexagon's exact modes, which
    are the triangle's, at a k with two triangle figures of one symmetry):
    then the second singular value dips too, and gives the second figure."""
    name, p, kind, nu_max, k_top = args
    mps = Mps(POLYGONS[name], p, kind, nu_max)
    ks = np.arange(0.5, k_top + 2 * SCAN_STEP, SCAN_STEP)
    s = np.array([mps.sigma(k) for k in ks])
    found = []
    for i in range(1, len(ks) - 1):
        if not (s[i] <= s[i - 1] and s[i] < s[i + 1]):
            continue
        res = minimize_scalar(mps.sigma, bounds=(ks[i - 1], ks[i + 1]), method="bounded", options={"xatol": 1e-10})
        if res.fun > DIP_MAX:
            continue
        k = float(res.x)
        if any(abs(k / f["k"] - 1) < 1e-6 for f in found):
            continue
        sv = mps.sigmas(k)
        for which in range(int(np.sum(sv < DIP_MAX))):
            found.append({"k": k, "which": which, "sigma": float(sv[which])})
    return p, kind, mps.nus, [dict(f, coefs=mps.coefficients(f["k"], f["which"])) for f in found]


def solve_polygon(name, k_top):
    """Every eigenvalue of every symmetry class up to k_top, each class
    scanning its own (scan_class), one process per class."""
    poly = POLYGONS[name]
    nu_max = int(os.environ.get(f"NU{poly.n}", NU_MAX[name]))
    classes = class_list(poly.n)
    mult_of = {(p, kind): mult for p, kind, mult in classes}
    with ProcessPoolExecutor(max_workers=min(len(classes), os.cpu_count() or 1)) as pool:
        scans = list(pool.map(scan_class, [(name, p, kind, nu_max, k_top) for p, kind, _ in classes]))
    modes = []
    for p, kind, nus, found in scans:
        for f in found:
            modes.append({"k": f["k"], "p": p, "kind": kind, "which": f["which"], "mult": mult_of[(p, kind)], "nus": nus, "coefs": f["coefs"], "sigma": f["sigma"]})
    # No class owns the same eigenvalue twice over (scan_class's guard).
    seen = set()
    for m in modes:
        key = (m["p"], m["kind"], round(m["k"], 6), m["which"])
        assert key not in seen, f"{name}: class {m['p']} {m['kind']} holds k {m['k']:.6f} twice"
        seen.add(key)
    return modes, nu_max


def spread(rows, count):
    """`count` of `rows` (sorted by k), evenly spaced by index. By Weyl's law a
    plate's eigenvalues come about evenly spaced in k^2, so this spreads the
    figures about evenly over the ratio range, as the square's are. Mirrored
    by spreadPick in chladniPlates.ts."""
    if len(rows) <= count:
        return list(rows)
    idx = [int(math.floor(i * (len(rows) - 1) / (count - 1) + 0.5)) for i in range(count)]
    return [rows[i] for i in idx]


# ---- Triangle: Lame's plane waves -----------------------------------------


def triangle_dual():
    """Columns k1, k2 of the dual of the reflected tiling's translation
    lattice (twice the altitude along two edge normals): k_i . t_j = 2 pi
    delta_ij. Every wave in a triangle mode is an integer mix of the two."""
    s3 = math.sqrt(3)
    t = np.stack([2 * s3 * np.array([0.0, 1.0]), 2 * s3 * np.array([s3 / 2, 0.5])], 1)
    return 2 * math.pi * np.linalg.inv(t).T


def triangle_modes(lam_max):
    s3 = math.sqrt(3)
    apex = np.array([0.0, s3 / 2])
    centroid = np.array([0.0, -1 / (2 * s3)])
    normals = [np.array([0.0, 1.0]), np.array([s3 / 2, 0.5]), np.array([-s3 / 2, 0.5])]
    refl = [np.eye(2) - 2 * np.outer(n, n) for n in normals]
    group = [np.eye(2), refl[0], refl[1], refl[2], refl[0] @ refl[1], refl[1] @ refl[0]]
    dual = triangle_dual()
    span = int(math.ceil(math.sqrt(lam_max) / (2 * math.pi / 3))) + 2
    waves = {}
    for a in range(-span, span + 1):
        for b in range(-span, span + 1):
            k = dual @ np.array([a, b], float)
            lam = float(k @ k)
            if 1e-9 < lam <= lam_max * (1 + 1e-9):
                waves.setdefault(round(lam, 6), []).append(k)

    dual_inv = np.linalg.inv(dual)

    def canon(q):
        # Keyed by the wave's integer coordinates on the dual lattice, one of
        # each +-q pair (cos is even, sin odd: the sign says which).
        key = tuple(int(v) for v in np.rint(dual_inv @ q))
        neg = tuple(-v for v in key)
        return (key, 1.0) if key > neg else (neg, -1.0)

    def vec(key):
        return dual @ np.array(key, float)

    out = []
    for lam in sorted(waves):
        keys = sorted({canon(q)[0] for q in waves[lam]})
        index = {q: i for i, q in enumerate(keys)}
        dim = 2 * len(keys)  # cos(q.(p - apex)) then sin(q.(p - apex)) for each q

        def put(vec, q, kind, coef):
            key, sgn = canon(q)
            i = index[key]
            if kind == "cos":
                vec[2 * i] += coef
            else:
                vec[2 * i + 1] += sgn * coef

        gens = []
        for k in waves[lam]:
            re, im = np.zeros(dim), np.zeros(dim)
            for w in group:
                put(re, w @ k, "cos", 1.0)
                put(im, w @ k, "sin", 1.0)
            for v in (re, im):
                if np.linalg.norm(v) > 1e-9:
                    gens.append(v)
        u, s, vt = svd(np.array(gens), full_matrices=False)
        basis = vt[s > 1e-8 * s[0]]

        # The vertical mirror and the 120-degree turn about the centroid, as
        # maps on (cos, sin) coefficients.
        def apply(op_q, phase_of):
            m = np.zeros((dim, dim))
            for key, i in index.items():
                q = vec(key)
                q2 = op_q(q)
                ph = phase_of(q, q2)
                key2, sgn = canon(q2)
                j = index[key2]
                # cos(q.y') -> cos(q2.y' + ph) = cos ph cos - sin ph sin
                m[2 * j, 2 * i] += math.cos(ph)
                m[2 * j + 1, 2 * i] += -math.sin(ph) * sgn
                # sin(q.y') -> sin(q2.y' + ph) = cos ph sin + sin ph cos
                m[2 * j + 1, 2 * i + 1] += math.cos(ph) * sgn
                m[2 * j, 2 * i + 1] += math.sin(ph)
            return m

        mirror = apply(lambda q: np.array([-q[0], q[1]]), lambda q, q2: 0.0)
        c, s_ = math.cos(2 * math.pi / 3), math.sin(2 * math.pi / 3)
        rot = np.array([[c, -s_], [s_, c]])
        turn = apply(lambda q: rot.T @ q, lambda q, q2: float((q2 - q) @ (apex - centroid)))
        msub = basis @ mirror @ basis.T
        tsub = basis @ turn @ basis.T
        assert np.allclose(msub @ msub.T, np.eye(len(basis)), atol=1e-8), "eigenspace not mirror-closed"

        def null(stack):
            _, sv, vv = svd(stack)
            sv = np.concatenate([sv, np.zeros(vv.shape[0] - len(sv))])
            return vv[sv < 1e-7]

        eye = np.eye(len(basis))
        a1 = null(np.vstack([msub - eye, tsub - eye]))
        a2 = null(np.vstack([msub + eye, tsub - eye]))
        even = null(msub - eye)
        if len(a1):
            even = even - (even @ a1.T) @ a1
            _, sv, vv = svd(even)
            even = vv[: int(np.sum(sv > 1e-7))]
        picks = [("3-fold", v) for v in a1] + [("3-fold", v) for v in a2] + [("mirror", v) for v in even]
        for sym, v in picks:
            coef = v @ basis
            terms = []
            for key, i in index.items():
                q = vec(key)
                ca, sb = coef[2 * i], coef[2 * i + 1]
                if abs(ca) < 1e-10 and abs(sb) < 1e-10:
                    continue
                qa = float(q @ apex)
                # Re-centre on the plate origin: q.(p - apex) = q.p - q.apex.
                terms.append([q[0], q[1], ca * math.cos(qa) - sb * math.sin(qa), ca * math.sin(qa) + sb * math.cos(qa)])
            out.append({"k": float(np.linalg.norm(waves[lam][0])), "sym": sym, "terms": np.array(terms), "mult": len(basis)})
    return out


def wave_eval(terms, x, y):
    ph = np.outer(x, terms[:, 0]) + np.outer(y, terms[:, 1])
    c, s = np.cos(ph), np.sin(ph)
    f = c @ terms[:, 2] + s @ terms[:, 3]
    d = -s * terms[:, 2] + c * terms[:, 3]
    return f, d @ terms[:, 0], d @ terms[:, 1]


# ---- Checks and descriptions ----------------------------------------------


def edge_residual(poly, evaluate, rng):
    bp, bn = edge_points(poly, 120, half=False)
    _, gx, gy = evaluate(bp[:, 0], bp[:, 1])
    slope_edge = np.sqrt(np.mean((gx * bn[:, 0] + gy * bn[:, 1]) ** 2))
    ip = poly.random_inside(3000, rng)
    _, ix, iy = evaluate(ip[:, 0], ip[:, 1])
    return float(slope_edge / np.sqrt(np.mean(ix**2 + iy**2)))


def peak_and_cells(poly, evaluate):
    g = np.linspace(-1, 1, 361)
    x, y = np.meshgrid(g, g)
    inside = poly.gauge(x, y) < 0.995
    f, _, _ = evaluate(x[inside], y[inside])
    full = np.zeros_like(x)
    full[inside] = f
    peak = float(np.max(np.abs(f)))
    cells = 0
    for sign in (1, -1):
        lab, n = ndimage.label((sign * full) > 0.02 * peak)
        sizes = ndimage.sum(np.ones_like(full), lab, range(1, n + 1))
        cells += int(np.sum(sizes > 12))
    return peak, cells


def pick_even(m, rng):
    """Whether a figure is even about the vertical. Every mode here is even or
    odd; only the even ones become figures, because the plate shows a blend
    of several at once and a blend of even figures stays mirror-symmetric
    (all of the square's figures are even too). Every class still takes part
    in the finite-element count above."""
    p = rng.uniform(-0.5, 0.5, size=(64, 2))
    f1 = m["eval"](p[:, 0], p[:, 1])[0]
    f2 = m["eval"](-p[:, 0], p[:, 1])[0]
    scale = np.max(np.abs(f1))
    if np.allclose(f1, f2, atol=1e-6 * scale):
        return True
    assert np.allclose(f1, -f2, atol=1e-6 * scale), "a mode with no mirror parity"
    return False


def prune(m, peak):
    """Drops terms that never reach PRUNE_SHARE of the peak anywhere within a
    little past the plate (so the client needn't evaluate them): the series'
    high orders are tiny Bessel values times huge coefficients, and most of
    them add nothing."""
    if "coefs" in m:
        r = np.linspace(0, 1.05, 400)
        for i, nu in enumerate(m["nus"]):
            if np.max(np.abs(m["coefs"][i] * special.jv(nu, m["k"] * r))) < PRUNE_SHARE * peak:
                m["coefs"][i] = 0.0
    else:
        t = m["terms"]
        t[np.abs(t[:, 2]) < PRUNE_SHARE * peak, 2] = 0.0
        t[np.abs(t[:, 3]) < PRUNE_SHARE * peak, 3] = 0.0


def fmt(v):
    return float(f"{v:.10g}")


def main():
    check_only = "--check" in sys.argv
    names = [a for a in sys.argv[1:] if a in POLYGONS] or list(POLYGONS)
    assert check_only or len(names) == len(POLYGONS), "naming shapes needs --check: the file holds every table"
    rng = np.random.default_rng(1729)
    tables = {}
    failures = []

    # Polygons by particular solutions, triangle by plane waves; all checked
    # against the finite-element eigenvalues up to a cut just past K_TOP.
    k_scan = K_TOP * 1.01
    k_min = K_FUNDAMENTAL * math.sqrt(RATIO_MIN)
    for name in names:
        poly = POLYGONS[name]
        fem, nodes = fem_wave_numbers(poly, k_scan)
        if name == "triangle":
            raw = triangle_modes(k_scan**2)
            found = []
            for m in raw:
                m["eval"] = (lambda terms: lambda x, y: wave_eval(terms, x, y))(m["terms"])
                found.append(m)
            spectrum = sorted({round(m["k"], 9): m["mult"] for m in raw}.items())
            ours = np.sort(np.concatenate([[k] * mult for k, mult in spectrum]))
            how = "exact"
        else:
            raw, nu_max = solve_polygon(name, k_scan)
            found = []
            for m in raw:
                m["eval"] = (lambda mm: lambda x, y: series_eval(mm["k"], mm["nus"], mm["kind"], mm["coefs"], x, y))(m)
                m["sym"] = f"{poly.n}-fold" if m["mult"] == 1 else "mirror"
                found.append(m)
            ours = np.sort(np.concatenate([[m["k"]] * m["mult"] for m in raw]))
            how = f"nu_max {nu_max}"
        cut = cut_past(fem, K_TOP)
        fem_c, ours_c = fem[fem < cut], ours[ours < cut]
        agree = np.abs(fem_c / ours_c - 1) if len(ours_c) == len(fem_c) else np.array([1.0])
        print(f"{name}: {len(fem_c)} eigenvalues to k {cut:.3f}, FEM nodes {nodes}, ours {len(ours_c)} ({how}), worst k disagreement {agree.max():.2e}")
        if agree.max() > K_AGREE:
            failures.append(f"{name}: {len(ours_c)} eigenvalues against FEM's {len(fem_c)}, worst disagreement {agree.max():.2e}")
            # Pair the two sorted lists where they agree to MATCH_SHOW and show
            # what is left on either side.
            i = j = 0
            while i < len(ours_c) or j < len(fem_c):
                if i < len(ours_c) and j < len(fem_c) and abs(ours_c[i] / fem_c[j] - 1) < MATCH_SHOW:
                    i += 1
                    j += 1
                elif j >= len(fem_c) or (i < len(ours_c) and ours_c[i] < fem_c[j]):
                    print(f"   ours {ours_c[i]:.5f}  not in FEM")
                    i += 1
                else:
                    print(f"   fem {fem_c[j]:.5f}  not found")
                    j += 1
        found.sort(key=lambda m: m["k"])
        # The even figures on the square's range, then FIGURES of them spread
        # over it.
        even = [m for m in found if k_min <= m["k"] <= K_TOP * (1 + 1e-9) and pick_even(m, rng)]
        rows = []
        for m in spread(even, FIGURES):
            prune(m, peak_and_cells(poly, m["eval"])[0])
            res = edge_residual(poly, m["eval"], rng)
            peak, cells = peak_and_cells(poly, m["eval"])
            if res > RESIDUAL_MAX:
                failures.append(f"{name} k={m['k']:.4f}: edge residual {res:.3e}")
            m.update(ratio=(m["k"] / K_FUNDAMENTAL) ** 2, residual=res, peak=peak, cells=cells)
            rows.append(m)
        print(f"  {len(rows)} of {len(even)} even figures; edge residual max {max(r['residual'] for r in rows):.2e}")
        for r in rows:
            own = f" dip {r['sigma']:.3f}" if "sigma" in r else ""
            print(f"   k {r['k']:.5f} ratio {r['ratio']:6.2f} {r['sym']:7s} cells {r['cells']:3d} residual {r['residual']:.1e}{own}")
        tables[name] = rows

    if failures:
        print("FAILED:\n  " + "\n  ".join(failures))
        sys.exit(1)
    if check_only:
        return

    lines = [
        "// GENERATED by tools/chladni-plate-modes.py: do not edit by hand.",
        "// Regenerate: uv run tools/chladni-plate-modes.py (or uvx --with numpy",
        "// --with scipy python tools/chladni-plate-modes.py). That tool's header has",
        "// the maths: free-edge membrane modes of the hexagon and decagon by the method",
        "// of particular solutions, the equilateral triangle's by Lame's plane waves,",
        "// every eigenvalue checked against a finite-element solve.",
        "//",
        "// k is the mode's wave number in plate units; ratio = (k / K)^2, K the",
        "// square's (1, 2) mode's (pi sqrt FUNDAMENTAL_ORDER in chladniPlates.ts). A",
        "// series mode is sum_j coefs[j] J_nus[j](k r) cs(nus[j] theta), theta from",
        "// the vertical, cs = cos or sin; a wave mode is the sum of c cos(q . p) +",
        "// s sin(q . p) over waves = [i, j, c, s, ...], q = i k1 + j k2 with k1, k2",
        "// from TRIANGLE_DUAL ([k1x, k1y, k2x, k2y]); parity says whether it is even",
        "// (1) or odd (-1) about the vertical. Each is scaled to peak |f| about 1",
        "// (the client rescales to exactly 2 on its own grid). residual = RMS edge",
        "// slope / RMS slope inside; domains = nodal cells counted on a grid.",
        "",
        "export interface SeriesPlateMode {",
        "  k: number;",
        "  ratio: number;",
        '  kind: "cos" | "sin";',
        "  nus: readonly number[];",
        "  coefs: readonly number[];",
        "  sym: string;",
        "  domains: number;",
        "  residual: number;",
        "}",
        "",
        "export interface WavePlateMode {",
        "  k: number;",
        "  ratio: number;",
        "  waves: readonly number[];",
        "  parity: 1 | -1;",
        "  sym: string;",
        "  domains: number;",
        "  residual: number;",
        "}",
        "",
    ]
    for name, const in (("hexagon", "HEXAGON_MODES"), ("decagon", "DECAGON_MODES")):
        lines.append(f"export const {const}: readonly SeriesPlateMode[] = [")
        for r in tables[name]:
            keep = [i for i, c in enumerate(r["coefs"]) if c != 0]
            nus = [r["nus"][i] for i in keep]
            coefs = [float(f"{r['coefs'][i] / r['peak']:.12g}") for i in keep]
            lines.append(
                f'  {{ k: {fmt(r["k"])}, ratio: {fmt(r["ratio"])}, kind: "{r["kind"]}", nus: {nus}, coefs: {coefs}, sym: "{r["sym"]}", domains: {r["cells"]}, residual: {r["residual"]:.2g} }},'
            )
        lines.append("];")
        lines.append("")
    dual = triangle_dual()
    dual_inv = np.linalg.inv(dual)
    lines.append(f"export const TRIANGLE_DUAL = [{fmt(dual[0, 0])}, {fmt(dual[1, 0])}, {fmt(dual[0, 1])}, {fmt(dual[1, 1])}] as const;")
    lines.append("")
    lines.append("export const TRIANGLE_MODES: readonly WavePlateMode[] = [")
    probe = rng.uniform(-0.5, 0.5, size=(64, 2))
    for r in tables["triangle"]:
        flat = []
        for qx, qy, ca, sb in r["terms"]:
            if ca == 0 and sb == 0:
                continue
            a, b = (int(v) for v in np.rint(dual_inv @ np.array([qx, qy])))
            flat += [a, b, float(f"{ca / r['peak']:.12g}"), float(f"{sb / r['peak']:.12g}")]
        f1 = r["eval"](probe[:, 0], probe[:, 1])[0]
        f2 = r["eval"](-probe[:, 0], probe[:, 1])[0]
        parity = 1 if np.allclose(f1, f2, atol=1e-9 * r["peak"]) else -1
        assert parity == 1 or np.allclose(f1, -f2, atol=1e-9 * r["peak"]), "triangle mode with no mirror parity"
        lines.append(
            f'  {{ k: {fmt(r["k"])}, ratio: {fmt(r["ratio"])}, waves: {flat}, parity: {parity}, sym: "{r["sym"]}", domains: {r["cells"]}, residual: {r["residual"]:.2g} }},'
        )
    lines.append("];")
    lines.append("")
    OUT.write_text("\n".join(lines))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
