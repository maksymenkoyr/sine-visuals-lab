"""The alien's model, built headless in Blender from the owner's picks on #772:
B's body from the round-1 design sheet, a head after the owner's head
picture, and that head squeezed hard as a shape key. Writes
tools/.cache/alien-model/alien.bin, the mesh the scene loads once #773 puts
it in, and renders the model under tools/.cache/alien-model/renders/.

  node --experimental-strip-types tools/alien-model/exportRig.ts
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/alien-model/build.py [-- --quick] [-- --no-render]

The shape is a signed-distance field written as data, in the rig's metres
and axes (+Y up, the figure faces +Z), around the bind pose exportRig.ts
writes. Lofts (a cross-section swept along an axis, sized per station from
the measured views) carry the torso, limbs, neck and head; small parts add
the anatomy, applied in order as smooth unions and carves. "raise" and
"socket" parts move the surface out or in by a set depth inside an outline,
so a lip or an eye socket follows the face's curve. The field is sampled
only in blocks near the surface and meshed by OpenVDB into one closed
surface: the neck and head can't cross each other the way today's two
surfaces do. Blender then decimates it by curvature, a density group
keeping the face, hands and feet fine; skins it with automatic weights;
and adds the squeeze, whose own field the head's vertices are warped onto
(landmark to landmark), then projected and relaxed, so the shape key keeps
the mesh's own topology.

Blender is Z-up: rig (x, y, z) is Blender (x, -z, y).

alien.bin, little-endian, each section a whole array in this order: the
magic ALM1, uint32 vertex count, uint32 triangle count; float32 position x3
(bind pose, rig metres); int8 normal x4 (unit normal x 127, then 0); uint8
bone x4 (BONES order); uint8 weight x4 (summing to 255); float32 squeeze x3
(squeezed minus normal position, 0 below the neck); int8 squeezed normal x4;
uint16 index x3 per triangle, wound so the normal points out.

Nothing here is random: a rerun writes the same alien.bin.
"""
import json
import math
import struct
import sys
import time
from pathlib import Path

import bpy
import numpy as np
import openvdb as vdb
from mathutils import Matrix, Vector

T_START = time.time()


def script_path():
    try:
        return Path(__file__).resolve()
    except NameError:
        return Path(sys.argv[sys.argv.index("-P") + 1]).resolve()


ROOT = script_path().parents[2]
OUT = ROOT / "tools/.cache/alien-model"
RENDERS = OUT / "renders"
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
QUICK = "--quick" in ARGS
RENDER = "--no-render" not in ARGS

# Voxel edge of the sampled field: fine enough for the lips and the fingers under
# the face's decimated triangles. At 2 mm Blender's symmetric decimate folded over
# 500 triangles (dark specks in the wire); at 3 mm about 10. 4 mm is enough to judge
# proportions.
VOXEL = float(ARGS[ARGS.index("--voxel") + 1]) if "--voxel" in ARGS else 0.004 if QUICK else 0.003
BLOCK = 16
# Today's mesh (docs/scenes/alien/scripts/meshcheck.ts) is the budget.
TARGET_TRIS = 20000
BIG = 10.0

RIG = json.loads((OUT / "rig.json").read_text())
BONES = RIG["bones"]
BONE_INDEX = {b["name"]: i for i, b in enumerate(BONES)}


def log(*a):
    print(f"[alien {time.time() - T_START:6.1f}s]", *a, flush=True)


# ---- Small maths ------------------------------------------------------------


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def pchip(xs, ys, xq):
    """Monotone cubic through the stations: no overshoot between measured rows."""
    xs = np.asarray(xs, float)
    ys = np.asarray(ys, float)
    if len(xs) == 1:
        return np.full_like(np.asarray(xq, float), ys[0])
    h = np.diff(xs)
    dl = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[0], m[-1] = dl[0], dl[-1]
    for i in range(1, len(xs) - 1):
        if dl[i - 1] * dl[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i])
    xq = np.asarray(xq, float)
    i = np.clip(np.searchsorted(xs, xq) - 1, 0, len(xs) - 2)
    t = np.clip((xq - xs[i]) / h[i], 0.0, 1.0)
    t2, t3 = t * t, t * t * t
    return (
        (2 * t3 - 3 * t2 + 1) * ys[i]
        + (t3 - 2 * t2 + t) * h[i] * m[i]
        + (-2 * t3 + 3 * t2) * ys[i + 1]
        + (t3 - t2) * h[i] * m[i + 1]
    )


def frame(w, u_hint):
    """Orthonormal (u, v, w): w the given normal, u as close to u_hint as the tangent plane allows."""
    w = unit(w)
    u = np.asarray(u_hint, float) - w * np.dot(u_hint, w)
    u = unit(u)
    v = np.cross(w, u)
    return np.stack([u, v, w], axis=1)


MIRROR = np.diag([-1.0, 1.0, 1.0])


# ---- Shapes -------------------------------------------------------------------


class Ellipsoid:
    def __init__(self, c, r, R=None):
        self.c = np.asarray(c, float)
        self.r = np.asarray(r, float)
        self.R = np.eye(3) if R is None else np.asarray(R, float)

    def sd(self, P):
        q = (P - self.c) @ self.R
        k0 = np.linalg.norm(q / self.r, axis=1)
        k1 = np.maximum(np.linalg.norm(q / (self.r * self.r), axis=1), 1e-9)
        return k0 * (k0 - 1.0) / k1

    def box(self):
        e = np.abs(self.R) @ self.r
        return self.c - e, self.c + e

    def mirrored(self):
        return Ellipsoid(MIRROR @ self.c, self.r, MIRROR @ self.R)


class Cone:
    """A capsule from a to b whose radius runs from ra to rb."""

    def __init__(self, a, b, ra, rb):
        self.a, self.b = np.asarray(a, float), np.asarray(b, float)
        self.ra, self.rb = ra, rb

    def sd(self, P):
        ba = self.b - self.a
        pa = P - self.a
        h = np.clip((pa @ ba) / (ba @ ba), 0.0, 1.0)
        return np.linalg.norm(pa - h[:, None] * ba, axis=1) - (self.ra + (self.rb - self.ra) * h)

    def box(self):
        r = max(self.ra, self.rb)
        return np.minimum(self.a, self.b) - r, np.maximum(self.a, self.b) + r

    def mirrored(self):
        return Cone(MIRROR @ self.a, MIRROR @ self.b, self.ra, self.rb)


class Leaf:
    """A leaf (two-arc lens) outline in a frame's u-v plane, half-length L along u and
    half-height H along v, as a slab from w0 to w1 along the frame's w."""

    def __init__(self, c, R, L, H, w0=-0.06, w1=0.06):
        self.c, self.R = np.asarray(c, float), np.asarray(R, float)
        self.L, self.H, self.w0, self.w1 = L, H, w0, w1
        self.rad = (L * L / H + H) / 2
        self.off = self.rad - H

    def sd(self, P):
        q = (P - self.c) @ self.R
        u, v, w = q[:, 0], q[:, 1], q[:, 2]
        d2 = np.maximum(np.hypot(u, v + self.off) - self.rad, np.hypot(u, v - self.off) - self.rad)
        dw = np.abs(w - (self.w0 + self.w1) / 2) - (self.w1 - self.w0) / 2
        return np.hypot(np.maximum(d2, 0), np.maximum(dw, 0)) + np.minimum(np.maximum(d2, dw), 0)

    def box(self):
        e = np.abs(self.R) @ np.array([self.L, self.H, max(abs(self.w0), abs(self.w1))])
        return self.c - e, self.c + e

    def mirrored(self):
        return Leaf(MIRROR @ self.c, MIRROR @ self.R, self.L, self.H, self.w0, self.w1)


class Both:
    """The intersection of two shapes."""

    def __init__(self, a, b):
        self.a, self.b = a, b

    def sd(self, P):
        return np.maximum(self.a.sd(P), self.b.sd(P))

    def box(self):
        (a0, a1), (b0, b1) = self.a.box(), self.b.box()
        return np.maximum(a0, b0), np.minimum(a1, b1)

    def mirrored(self):
        return Both(self.a.mirrored(), self.b.mirrored())


class Loft:
    """A cross-section swept along `axis` from origin `o`. At each station t (metres
    along the axis) the section is a superellipse: half-width a along `side`, half-depth
    c along `front`, centred at (xo, zo), exponent pf on its front half and pb on its back
    half. Stations are tables; between them the profile is a monotone cubic."""

    def __init__(self, o, axis, side, front, t, a, c, xo=None, zo=None, pf=2.0, pb=2.0):
        self.o, self.u, self.s, self.f = np.asarray(o, float), unit(axis), unit(side), unit(front)
        self.t0, self.t1 = float(t[0]), float(t[-1])
        self.tt = np.linspace(self.t0, self.t1, max(8, int((self.t1 - self.t0) / 0.001)))
        n = len(t)
        as_list = lambda v: [v] * n if np.isscalar(v) else v  # noqa: E731
        self.a = pchip(t, a, self.tt)
        self.c = pchip(t, c, self.tt)
        self.xo = pchip(t, as_list(0.0 if xo is None else xo), self.tt)
        self.zo = pchip(t, as_list(0.0 if zo is None else zo), self.tt)
        self.pf = pchip(t, as_list(pf), self.tt)
        self.pb = pchip(t, as_list(pb), self.tt)

    def _section(self, t, x, z):
        a = np.maximum(np.interp(t, self.tt, self.a), 1e-4)
        c = np.maximum(np.interp(t, self.tt, self.c), 1e-4)
        X = x - np.interp(t, self.tt, self.xo)
        Z = z - np.interp(t, self.tt, self.zo)
        p = np.where(Z >= 0, np.interp(t, self.tt, self.pf), np.interp(t, self.tt, self.pb))
        ax, az = np.abs(X) / a, np.abs(Z) / c
        r = (ax**p + az**p) ** (1 / p)
        return r, X, Z, a, c, p, ax, az

    def sd(self, P):
        Q = P - self.o
        t, x, z = Q @ self.u, Q @ self.s, Q @ self.f
        tc = np.clip(t, self.t0, self.t1)
        r, X, Z, a, c, p, ax, az = self._section(tc, x, z)
        rr = np.maximum(r, 1e-9) ** (1 - p)
        rx = np.sign(X) * ax ** (p - 1) / a * rr
        rz = np.sign(Z) * az ** (p - 1) / c * rr
        # The section's change along the axis belongs in the gradient too, or the
        # distance overestimates on a dome and blocks near it get culled.
        dt = 5e-4
        rt = (self._section(np.clip(tc + dt, self.t0, self.t1), x, z)[0] - self._section(np.clip(tc - dt, self.t0, self.t1), x, z)[0]) / (2 * dt)
        g = np.sqrt(rx * rx + rz * rz + rt * rt)
        dc = np.maximum((r - 1) / np.maximum(g, 1e-6), -np.minimum(a, c))
        beyond = np.abs(t - tc)
        return np.where(beyond > 0, np.where(dc > 0, np.hypot(dc, beyond), beyond), dc)

    def at(self, t):
        """Section centre and half-sizes at t."""
        i = lambda arr: float(np.interp(t, self.tt, arr))  # noqa: E731
        return i(self.xo), i(self.zo), i(self.a), i(self.c)

    def box(self):
        cs = self.o + np.outer(self.tt, self.u) + np.outer(self.xo, self.s) + np.outer(self.zo, self.f)
        es = np.abs(np.outer(self.a, self.s)) + np.abs(np.outer(self.c, self.f))
        return (cs - es).min(axis=0), (cs + es).max(axis=0)

    def mirrored(self):
        m = Loft.__new__(Loft)
        m.__dict__.update(self.__dict__)
        m.o, m.u, m.s, m.f = MIRROR @ self.o, MIRROR @ self.u, MIRROR @ self.s, MIRROR @ self.f
        return m


class Op:
    """One step of the field: add (smooth union), sub (smooth carve), raise (the surface
    moved out by `depth` inside the shape) or socket (moved in by `depth`)."""

    def __init__(self, kind, shape, k, depth=0.0):
        self.kind, self.shape, self.k, self.depth = kind, shape, k, depth

    def apply(self, d, P):
        x = self.shape.sd(P)
        if self.kind == "add":
            return smin(d, x, self.k)
        if self.kind == "sub":
            return smax(d, -x, self.k)
        if self.kind == "raise":
            return smin(d, np.maximum(x, d - self.depth), self.k)
        return smax(d, -np.maximum(x, -(d + self.depth)), self.k)

    def box(self, margin):
        lo, hi = self.shape.box()
        return lo - margin - self.k - self.depth, hi + margin + self.k + self.depth

    def mirrored(self):
        return Op(self.kind, self.shape.mirrored(), self.k, self.depth)


def eval_points(ops, P, margin=0.02):
    d = np.full(len(P), BIG)
    for op in ops:
        lo, hi = op.box(margin)
        idx = np.flatnonzero(np.all((P >= lo) & (P <= hi), axis=1))
        if idx.size:
            d[idx] = op.apply(d[idx], P[idx])
    return d


def gradient(ops, P, eps=4e-4):
    g = np.zeros_like(P)
    for i in range(3):
        e = np.zeros(3)
        e[i] = eps
        g[:, i] = (eval_points(ops, P + e) - eval_points(ops, P - e)) / (2 * eps)
    return g


def surface_hit(ops, origin, direction, far=0.6):
    """Where a ray from inside the shape leaves it, and the outward normal there."""
    o, dv = np.asarray(origin, float), unit(direction)
    lo, hi = 0.0, far
    for _ in range(50):
        mid = (lo + hi) / 2
        if eval_points(ops, (o + dv * mid)[None])[0] < 0:
            lo = mid
        else:
            hi = mid
    p = o + dv * (lo + hi) / 2
    return p, unit(gradient(ops, p[None])[0])


# ---- B's body (round 1 sheet, front and side views) ---------------------------
# Measured from tools/.cache/alien-design/round1/b-sleepy.png at 1.7 mm per pixel:
# the scale at which B's ankle-knee and knee-hip spans match the rig's shin and
# thigh. Heights go through the rig's own joints (sole, ankle, knee, hip, shoulder),
# so the rig's longer torso stretches B's between hip and shoulder. Front and back z
# are measured from the line of B's neck, shoulder and knee, where the rig's bones are.

TORSO = [  # y, half-width, front z, back z
    # Tapered into the legs: a flat end here drew a hem across the hips.
    (0.840, 0.080, 0.025, -0.045), (0.875, 0.125, 0.048, -0.070), (0.900, 0.146, 0.062, -0.084),
    (0.927, 0.144, 0.068, -0.100), (0.965, 0.141, 0.085, -0.114), (1.005, 0.139, 0.097, -0.117),
    (1.044, 0.134, 0.109, -0.114), (1.083, 0.129, 0.116, -0.102), (1.123, 0.130, 0.119, -0.087),
    (1.162, 0.121, 0.119, -0.073), (1.201, 0.112, 0.119, -0.068), (1.241, 0.107, 0.116, -0.068),
    (1.280, 0.112, 0.112, -0.071), (1.319, 0.121, 0.107, -0.080), (1.358, 0.128, 0.104, -0.092),
    (1.398, 0.133, 0.109, -0.102), (1.437, 0.138, 0.105, -0.110), (1.476, 0.142, 0.105, -0.117),
    (1.516, 0.150, 0.097, -0.128), (1.535, 0.156, 0.092, -0.129),
    # Above B's armpits the views are the arms'; the shoulder line is drawn here.
    (1.565, 0.158, 0.086, -0.126), (1.595, 0.152, 0.079, -0.117), (1.622, 0.135, 0.068, -0.098),
    (1.645, 0.100, 0.055, -0.074), (1.668, 0.058, 0.040, -0.052),
]
LEG = [  # y, centre x, half-width, front z, back z
    (0.050, 0.108, 0.026, 0.026, -0.036),
    (0.067, 0.108, 0.026, 0.024, -0.039), (0.104, 0.108, 0.026, 0.019, -0.042), (0.145, 0.106, 0.028, 0.018, -0.045),
    (0.185, 0.106, 0.031, 0.016, -0.052), (0.226, 0.105, 0.034, 0.016, -0.059), (0.266, 0.105, 0.038, 0.018, -0.065),
    (0.307, 0.104, 0.042, 0.020, -0.072), (0.348, 0.104, 0.044, 0.023, -0.072), (0.388, 0.104, 0.042, 0.027, -0.068),
    (0.429, 0.104, 0.039, 0.032, -0.060), (0.470, 0.101, 0.037, 0.048, -0.049), (0.510, 0.100, 0.037, 0.048, -0.042),
    (0.551, 0.100, 0.041, 0.046, -0.042), (0.592, 0.101, 0.045, 0.051, -0.048), (0.632, 0.102, 0.049, 0.056, -0.053),
    (0.673, 0.101, 0.052, 0.061, -0.056), (0.713, 0.099, 0.055, 0.065, -0.061), (0.754, 0.096, 0.059, 0.066, -0.066),
    (0.795, 0.093, 0.060, 0.068, -0.070), (0.835, 0.089, 0.062, 0.068, -0.073), (0.876, 0.085, 0.063, 0.066, -0.075),
    (0.940, 0.080, 0.066, 0.068, -0.080), (1.000, 0.076, 0.068, 0.070, -0.082),
]
ARM = [  # x along the arm (rig), vertical half-thickness, depth over height
    (0.110, 0.052, 1.0), (0.201, 0.050, 1.0), (0.245, 0.042, 1.0), (0.290, 0.036, 1.0), (0.334, 0.034, 1.0),
    (0.379, 0.032, 1.0), (0.423, 0.031, 1.02), (0.468, 0.028, 1.05), (0.497, 0.027, 1.08), (0.528, 0.032, 1.1),
    (0.559, 0.038, 1.1), (0.589, 0.0365, 1.12), (0.619, 0.033, 1.15), (0.649, 0.029, 1.18), (0.679, 0.0246, 1.22),
    (0.709, 0.0229, 1.26), (0.740, 0.0206, 1.3), (0.770, 0.0204, 1.3), (0.790, 0.0215, 1.3),
]
FOOT = [  # z along the foot, half-width, sole y, top y
    (-0.078, 0.010, 0.014, 0.030), (-0.070, 0.022, 0.004, 0.046), (-0.056, 0.030, 0.000, 0.066),
    (-0.035, 0.032, 0.000, 0.086), (-0.010, 0.033, 0.000, 0.098), (0.020, 0.035, 0.000, 0.092),
    (0.050, 0.038, 0.000, 0.078), (0.090, 0.041, 0.000, 0.060), (0.130, 0.043, 0.000, 0.046),
    (0.170, 0.044, 0.000, 0.037), (0.200, 0.043, 0.001, 0.031), (0.225, 0.038, 0.003, 0.026),
    (0.240, 0.028, 0.006, 0.022), (0.252, 0.012, 0.010, 0.017),
]

# ---- The head (the owner's picture, front; its side designed after round 2) ---
# Front silhouette measured from tools/.cache/alien-design/owner-refs/head.png:
# half-width as a share of the widest, from the crown (u 0) to under the chin (u 1).
# The crown is a superellipse dome; below it, the measured rows.
HEAD_FRONT = [
    (0.30, 1.0), (0.365, 1.0), (0.394, 0.98), (0.423, 0.96), (0.453, 0.95), (0.482, 0.92), (0.511, 0.885),
    (0.540, 0.845), (0.569, 0.80), (0.599, 0.77), (0.628, 0.73), (0.657, 0.69), (0.686, 0.625), (0.715, 0.585),
    (0.745, 0.54), (0.774, 0.49), (0.803, 0.45), (0.832, 0.415), (0.861, 0.375), (0.891, 0.355), (0.920, 0.333),
    (0.949, 0.29), (0.978, 0.26), (1.0, 0.25),
    # Under the chin, tapering into the neck: a flat end drew a shelf there.
    (1.03, 0.23), (1.07, 0.2),
]
HEAD_DOME_U = 0.30
HEAD_DOME_P = 2.2
# Below the dome: the face's front and the skull's back, metres from the neck's axis.
HEAD_SIDE = [
    (0.30, 0.235, -0.285), (0.40, 0.250, -0.280), (0.50, 0.257, -0.268), (0.60, 0.256, -0.250),
    (0.667, 0.252, -0.228), (0.708, 0.249, -0.200), (0.75, 0.245, -0.165), (0.79, 0.241, -0.115),
    (0.833, 0.236, -0.075), (0.875, 0.231, -0.055), (0.917, 0.224, -0.047), (0.958, 0.208, -0.045),
    (1.0, 0.178, -0.045), (1.03, 0.13, -0.044), (1.07, 0.06, -0.04),
]
HEAD_APEX_Z = -0.085
# B's head height on the rig: the chin sits as far above the shoulder as B's does.
HEAD_CHIN_Y = 1.80
HEAD_H = 0.643
# The owner's head is this much taller than wide.
HEAD_ASPECT = 1.43
HEAD_HALF_W = HEAD_H / HEAD_ASPECT / 2
HEAD_TOP_Y = HEAD_CHIN_Y + HEAD_H


def head_y(u):
    return HEAD_TOP_Y - u * HEAD_H


def build_head_loft():
    us = np.concatenate([np.linspace(0, HEAD_DOME_U, 40)[:-1], np.linspace(HEAD_DOME_U, HEAD_FRONT[-1][0], 64)])
    dome = lambda u: (1 - np.abs(1 - u / HEAD_DOME_U) ** HEAD_DOME_P) ** (1 / HEAD_DOME_P)  # noqa: E731
    fu, fw = zip(*HEAD_FRONT)
    su, sf, sb = zip(*HEAD_SIDE)
    a, zo, c = [], [], []
    top_zo = (HEAD_SIDE[0][1] + HEAD_SIDE[0][2]) / 2
    top_c = (HEAD_SIDE[0][1] - HEAD_SIDE[0][2]) / 2
    for u in us:
        if u < HEAD_DOME_U:
            k = dome(u)
            a.append(HEAD_HALF_W * k)
            c.append(top_c * k)
            zo.append(HEAD_APEX_Z + (top_zo - HEAD_APEX_Z) * math.sin(u / HEAD_DOME_U * math.pi / 2))
        else:
            a.append(HEAD_HALF_W * float(np.interp(u, fu, fw)))
            f, b = float(np.interp(u, su, sf)), float(np.interp(u, su, sb))
            zo.append((f + b) / 2)
            c.append((f - b) / 2)
    # The face is flatter across than the skull is round: a squarer front half
    # between the brow and the mouth.
    pf = [2.0 + 0.6 * float(smoothstep(0.25, 0.4, u) * (1 - smoothstep(0.62, 0.78, u))) for u in us]
    t = [head_y(u) for u in us][::-1]
    rev = lambda v: v[::-1]  # noqa: E731
    return Loft([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], t, rev(a), rev(c), zo=rev(zo), pf=rev(pf), pb=2.0)


# ---- The field ----------------------------------------------------------------


def body_ops():
    ops = []
    ty, ta, tf, tb = map(list, zip(*TORSO))
    torso = Loft([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], ty, ta, [(f - b) / 2 for f, b in zip(tf, tb)],
                 zo=[(f + b) / 2 for f, b in zip(tf, tb)],
                 pf=[2.0 + 0.3 * float(smoothstep(1.25, 1.45, y)) for y in ty],
                 pb=[2.0 + 0.3 * float(smoothstep(1.25, 1.45, y)) for y in ty])
    ops.append(Op("add", torso, 0.0))
    neck = Loft([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], [1.55, 1.60, 1.66, 1.72, 1.78, 1.84, 1.90],
                [0.062, 0.058, 0.050, 0.047, 0.048, 0.052, 0.056], [0.066, 0.062, 0.054, 0.051, 0.052, 0.056, 0.06],
                zo=[0.0, 0.0, 0.004, 0.008, 0.01, 0.012, 0.012])
    ops.append(Op("add", neck, 0.035))

    left = []
    # Shoulders: trapezius and deltoid; the collarbones go on after the mirror.
    left.append(Op("add", Cone([0.03, 1.676, -0.016], [0.185, 1.636, -0.012], 0.034, 0.04), 0.04))
    left.append(Op("add", Ellipsoid([0.205, 1.612, 0.0], [0.06, 0.052, 0.052]), 0.03))
    shoulder = [Op("add", torso, 0.0), ops[1]] + left[:2]
    ly, lx, la, lf, lb = map(list, zip(*LEG))
    leg = Loft([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], ly, la, [(f - b) / 2 for f, b in zip(lf, lb)],
               xo=lx, zo=[(f + b) / 2 for f, b in zip(lf, lb)])
    left.append(Op("add", leg, 0.04))
    ax_, ah, ar = map(list, zip(*ARM))
    arm = Loft([0, 1.61, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], ax_, [h * r for h, r in zip(ah, ar)], ah)
    left.append(Op("add", arm, 0.03))
    # Elbow point and kneecap.
    left.append(Op("add", Ellipsoid([0.492, 1.612, -0.02], [0.02, 0.017, 0.012]), 0.016))
    left.append(Op("add", Ellipsoid([0.101, 0.497, 0.034], [0.024, 0.028, 0.016]), 0.02))
    # Ankle bones either side.
    for s in (-1, 1):
        left.append(Op("add", Ellipsoid([0.108 + s * 0.022, 0.078, -0.006], [0.011, 0.013, 0.012]), 0.012))
    fz, fa, fb, ft = map(list, zip(*FOOT))
    foot = Loft([0.106, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], fz, fa, [(t - b) / 2 for t, b in zip(ft, fb)],
                zo=[(t + b) / 2 for t, b in zip(ft, fb)], pf=2.0, pb=3.5)
    left.append(Op("add", foot, 0.03))
    for i, dx in enumerate((-0.021, 0.0, 0.021)):
        left.append(Op("add", Ellipsoid([0.106 + dx, 0.0135, 0.232 - abs(dx) * 0.35], [0.0115, 0.0115, 0.016]), 0.008))

    # The hand: palm down, three long fingers fanned in the palm's plane, a thumb forward.
    left.append(Op("add", Ellipsoid([0.842, 1.607, 0.0], [0.072, 0.017, 0.044]), 0.016))
    for j in (-1, 0, 1):
        ang = 0.19 * j
        length = 0.172 if j == 0 else 0.155
        base = np.array([0.898, 1.607, 0.026 * j])
        dirv = unit([math.cos(ang), -0.05, math.sin(ang)])
        joints = [base, base + dirv * length * 0.42, base + dirv * length * 0.75, base + dirv * length]
        radii = [0.0105, 0.0094, 0.0085, 0.0076]
        for a_, b_, ra, rb in zip(joints[:-1], joints[1:], radii[:-1], radii[1:]):
            left.append(Op("add", Cone(a_, b_, ra, rb), 0.006))
        for jp in joints[1:3]:
            left.append(Op("add", Ellipsoid(jp, [0.0108, 0.0101, 0.0108]), 0.004))
        left.append(Op("add", Ellipsoid(joints[-1] - dirv * 0.002, [0.0115, 0.0092, 0.0107]), 0.005))
    tb_ = np.array([0.80, 1.600, 0.034])
    td = unit([0.5, -0.15, 0.85])
    left.append(Op("add", Cone(tb_, tb_ + td * 0.052, 0.0125, 0.0100), 0.012))
    left.append(Op("add", Cone(tb_ + td * 0.052, tb_ + td * 0.095, 0.0100, 0.0084), 0.005))
    left.append(Op("add", Ellipsoid(tb_ + td * 0.095, [0.0102, 0.0092, 0.0102]), 0.004))

    ops += left + [op.mirrored() for op in left]

    # Collarbones and the notch between them, placed on the chest's surface.
    chest_only = [Op("add", torso, 0.0)]
    collar = []
    for x in (0.02, 0.09, 0.165):
        p, n = surface_hit(shoulder, [x, 1.628 + x * 0.1, -0.02], [0, 0.15, 1])
        collar.append(p - n * 0.006)
    left2 = [Op("add", Cone(collar[0], collar[1], 0.0085, 0.0095), 0.012),
             Op("add", Cone(collar[1], collar[2], 0.0095, 0.0105), 0.012)]
    ops += left2 + [op.mirrored() for op in left2]
    p, n = surface_hit(chest_only, [0, 1.636, 0.0], [0, 0, 1])
    ops.append(Op("sub", Ellipsoid(p + n * 0.008, [0.016, 0.012, 0.012]), 0.014))
    p, n = surface_hit(chest_only, [0, 1.13, 0.0], [0, 0, 1])
    ops.append(Op("sub", Ellipsoid(p + n * 0.002, [0.0065, 0.009, 0.01]), 0.006))
    return ops


def eye_frame(p, n, tilt_deg, side):
    t = math.radians(tilt_deg)
    return frame(n, [side * math.cos(t), math.sin(t), 0.0])


def head_ops():
    head = build_head_loft()
    ops = [Op("add", head, 0.065)]
    solid = [Op("add", head, 0.0)]

    def on_head(x, u, ops_=solid):
        y = head_y(u)
        return surface_hit(ops_, [x, y, -0.05], [0, 0, 1])

    W = HEAD_HALF_W * 2
    left = []
    # Eyes: narrow leaves tilted up at the outer corner, inset in smooth skin; the
    # picture has no lids standing proud of the face.
    pe, ne = on_head(0.227 * W, 0.453)
    Re = eye_frame(pe, ne, 28, 1)
    left.append(Op("socket", Leaf(pe, Re, 0.07, 0.031), 0.01, depth=0.019))
    # The eye fills its socket, a glossy convex lens.
    lens = Ellipsoid(pe - ne * 0.031, [0.082, 0.038, 0.024], Re)
    left.append(Op("add", Both(Leaf(pe, Re, 0.068, 0.0295), lens), 0.004))
    ops += left + [op.mirrored() for op in left]

    # The broad flat ridge from mid-forehead down between the eyes into the nose: a
    # buried ellipsoid, so it fades out with no outline.
    pr, nr = on_head(0.0, 0.45)
    ops.append(Op("add", Ellipsoid(pr - nr * 0.017, [0.036, 0.13, 0.02], frame(nr, [1, 0, 0])), 0.045))
    # A long thin nose ending in a small round bulb, nostrils under it.
    p0, n0 = on_head(0.0, 0.585)
    p1, n1 = on_head(0.0, 0.672)
    ops.append(Op("add", Cone(p0 - n0 * 0.004, p1 + n1 * 0.003, 0.0075, 0.0095), 0.014))
    pb, nb = on_head(0.0, 0.69)
    bulb = pb + nb * 0.005
    ops.append(Op("add", Ellipsoid(bulb, [0.015, 0.012, 0.012]), 0.01))
    for s in (-1, 1):
        ops.append(Op("sub", Ellipsoid(bulb + np.array([s * 0.008, -0.011, 0.004]), [0.0045, 0.003, 0.006]), 0.004))
    # A small mouth with thin lips, and the long chin under it.
    pm, nm = on_head(0.0, 0.82)
    Rm = frame(nm, [1, 0, 0])
    ops.append(Op("raise", Leaf(pm + Rm[:, 1] * 0.006, Rm, 0.042, 0.006), 0.008, depth=0.004))
    ops.append(Op("raise", Leaf(pm - Rm[:, 1] * 0.0075, Rm, 0.037, 0.0075), 0.008, depth=0.0045))
    ops.append(Op("socket", Leaf(pm, Rm, 0.04, 0.002), 0.002, depth=0.009))
    pch, nch = on_head(0.0, 0.93)
    ops.append(Op("raise", Leaf(pch, frame(nch, [1, 0, 0]), 0.034, 0.03), 0.03, depth=0.003))
    landmarks = {"eye": pe, "eye_n": ne, "eye_R": Re, "mouth": pm, "mouth_n": nm, "bulb": bulb, "chin": pch,
                 "brow": on_head(0.0, 0.36)[0], "head": head}
    return ops, landmarks


# ---- The squeezed head --------------------------------------------------------
# After tools/.cache/alien-design/owner-refs/shrunk.png: a small round ball of a head,
# barely bigger than the face; the eyes in thick puffy rims like goggles, the brow
# scrunched, a tiny nose, the mouth pursed and pushed forward. It is the normal head
# deformed (squeeze_positions), never a second surface: projecting the head onto a
# separately modelled squeezed head folded its triangles round the eyes, and warping
# the face with its own features crumpled them into the new ones.

SQ_CENTER = np.array([0.0, 2.0, -0.005])
SQ_RADII = np.array([0.15, 0.17, 0.165])
# The squeezed eye, rounder and less tilted than the normal one.
SQ_EYE_X, SQ_EYE_Y, SQ_EYE_TILT = 0.062, 2.0, 12
SQ_EYE_L, SQ_EYE_H = 0.043, 0.026
SQ_RIM = 0.012
SQ_EYE_SINK, SQ_EYE_BULGE = 0.01, 0.004
SQ_MOUTH_Y, SQ_MOUTH_PUSH = 1.895, 0.018
SQ_CHIN_Y = 1.858


def on_ball(x, y):
    """The squeezed ball's front at (x, y), and its outward normal there."""
    k = 1 - (x / SQ_RADII[0]) ** 2 - ((y - SQ_CENTER[1]) / SQ_RADII[1]) ** 2
    p = np.array([x, y, SQ_CENTER[2] + SQ_RADII[2] * math.sqrt(max(k, 0.0))])
    return p, unit((p - SQ_CENTER) / SQ_RADII**2)


# ---- Sampling and meshing -------------------------------------------------------


def mesh_field(ops, lo, hi, h):
    lo = np.asarray(lo, float)
    nb = np.ceil((np.asarray(hi) - lo) / (h * BLOCK)).astype(int)
    bidx = np.indices(nb).reshape(3, -1).T
    centres = lo + (bidx * BLOCK + (BLOCK - 1) / 2) * h
    reach = 0.5 * math.sqrt(3) * (BLOCK - 1) * h
    dc = eval_points(ops, centres, margin=reach * 2)
    active = bidx[np.abs(dc) < reach * 1.6 + 2 * h]
    log(f"blocks {len(active)} of {len(bidx)} near the surface, {len(active) * BLOCK**3 / 1e6:.1f}M samples")

    loc = np.indices((BLOCK,) * 3).reshape(3, -1).T
    bmin = lo + active * BLOCK * h
    bmax = bmin + (BLOCK - 1) * h
    D = np.full((len(active), BLOCK**3), BIG, np.float64)
    band = 3 * h
    for op in ops:
        olo, ohi = op.box(band)
        sel = np.flatnonzero(np.all((bmax >= olo) & (bmin <= ohi), axis=1))
        for chunk in np.array_split(sel, max(1, len(sel) // 192)):
            if chunk.size == 0:
                continue
            P = (bmin[chunk][:, None, :] + loc[None] * h).reshape(-1, 3)
            d = D[chunk].reshape(-1)
            m = np.flatnonzero(np.all((P >= olo) & (P <= ohi), axis=1))
            if m.size:
                d[m] = op.apply(d[m], P[m])
                D[chunk] = d.reshape(len(chunk), -1)
    log("field sampled")

    grid = vdb.FloatGrid(band)
    for i in range(len(active)):
        arr = np.clip(D[i], -band, band).astype(np.float32).reshape(BLOCK, BLOCK, BLOCK)
        grid.copyFromArray(arr, ijk=tuple(int(v) for v in active[i] * BLOCK), tolerance=0.0)
    grid.signedFloodFill()
    pts, tris, quads = grid.convertToPolygons(isovalue=0.0, adaptivity=0.0)
    V = lo + np.asarray(pts, float) * h
    F = [np.asarray(quads, np.int64)[:, [0, 1, 2]], np.asarray(quads, np.int64)[:, [0, 2, 3]]]
    if len(tris):
        F.append(np.asarray(tris, np.int64))
    F = np.concatenate(F)
    log(f"meshed: {len(V)} vertices, {len(F)} triangles")
    return V, F


def keep_largest_component(V, F):
    # Hook each edge's larger root onto the smaller, compress, repeat until no edge
    # joins two roots.
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]]])
    lab = np.arange(len(V))
    while True:
        a, b = lab[e[:, 0]], lab[e[:, 1]]
        m = np.minimum(a, b)
        new = lab.copy()
        np.minimum.at(new, a, m)
        np.minimum.at(new, b, m)
        while True:
            jumped = new[new]
            if np.array_equal(jumped, new):
                break
            new = jumped
        if np.array_equal(new, lab):
            break
        lab = new
    roots, counts = np.unique(lab, return_counts=True)
    keep = roots[np.argmax(counts)]
    if len(roots) > 1:
        log(f"dropped {len(roots) - 1} loose pieces ({counts.sum() - counts.max()} vertices)")
    vmask = lab == keep
    fmask = vmask[F[:, 0]]
    remap = -np.ones(len(V), np.int64)
    remap[vmask] = np.arange(vmask.sum())
    return V[vmask], remap[F[fmask]]


def signed_volume(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)


def vertex_normals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    n = np.zeros_like(V)
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


# ---- Blender side ---------------------------------------------------------------


def to_bl(p):
    p = np.asarray(p, float)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


def from_bl(p):
    p = np.asarray(p, float)
    return np.stack([p[..., 0], p[..., 2], -p[..., 1]], axis=-1)


def quat_rotate(q, v):
    x, y, z, w = q
    qv = np.array([x, y, z])
    t = 2 * np.cross(qv, v)
    return np.asarray(v) + w * t + np.cross(qv, t)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    return scene


def build_armature(scene):
    data = bpy.data.armatures.new("rig")
    arm = bpy.data.objects.new("rig", data)
    scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = []
    for b in BONES:
        eb = data.edit_bones.new(b["name"])
        eb.head = Vector(to_bl(b["head"]))
        eb.tail = Vector(to_bl(b["tail"]))
        eb.align_roll(Vector(to_bl(quat_rotate(b["rot"], [0.0, 0.0, 1.0]))))
        ebs.append(eb)
    for eb, b in zip(ebs, BONES):
        if b["parent"] >= 0:
            eb.parent = ebs[b["parent"]]
    # Nothing drives the jaw for the alien; the whole head rides the head bone.
    data.edit_bones["jaw"].use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def make_mesh_object(scene, name, V_rig, F):
    me = bpy.data.meshes.new(name)
    Vb = to_bl(V_rig).astype(np.float32)
    me.vertices.add(len(Vb))
    me.vertices.foreach_set("co", Vb.ravel())
    me.loops.add(F.size)
    me.loops.foreach_set("vertex_index", F.astype(np.int32).ravel())
    me.polygons.add(len(F))
    me.polygons.foreach_set("loop_start", (np.arange(len(F)) * 3).astype(np.int32))
    me.update(calc_edges=True)
    me.validate()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    return obj


def mesh_arrays(obj):
    me = obj.data
    V = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", V)
    me.calc_loop_triangles()
    F = np.zeros(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", F)
    return from_bl(V.reshape(-1, 3).astype(float)), F.reshape(-1, 3).astype(np.int64)


def apply_modifier(obj, mod):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def density(V, lm):
    """Where the decimation keeps small triangles: the face and the squeeze's features,
    the hands and the feet. The skull takes the biggest ones, so it is the one place
    with no density at all."""
    skull = np.maximum(smoothstep(head_y(0.42), head_y(0.30), V[:, 1]),
                       smoothstep(0.0, -0.06, V[:, 2]) * smoothstep(1.86, 1.96, V[:, 1]))
    w = BODY_DENSITY * (1 - skull)

    def bump(c, r, val):
        dist = np.linalg.norm(V - c, axis=1)
        return val * smoothstep(1.0, 0.0, dist / r)

    for s in (-1, 1):
        w = np.maximum(w, bump(MIRROR @ lm["eye"] if s < 0 else lm["eye"], 0.11, 0.45))
    w = np.maximum(w, bump(lm["bulb"], 0.06, 0.6))
    w = np.maximum(w, bump(lm["mouth"], 0.075, 0.7))
    w = np.maximum(w, bump(lm["chin"], 0.06, 0.35))
    w = np.maximum(w, bump(lm["brow"], 0.08, 0.35))
    w = np.maximum(w, 0.35 * smoothstep(0.74, 0.8, np.abs(V[:, 0])) * (V[:, 1] > 1.45))
    w = np.maximum(w, 0.25 * smoothstep(0.13, 0.07, V[:, 1]))
    return w


# Blender adds length x density x factor to an edge's collapse cost, which outweighs
# the curvature error by orders of magnitude unless the factor is this small.
DENSITY_FACTOR = float(ARGS[ARGS.index("--density") + 1]) if "--density" in ARGS else 0.06
BODY_DENSITY = float(ARGS[ARGS.index("--body") + 1]) if "--body" in ARGS else 0.15


def edge_report(V, F, lm):
    """Mean triangle edge per region: the skull's should be several times the face's."""
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    mid = (V[e[:, 0]] + V[e[:, 1]]) / 2
    ln = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)
    near = lambda c, r: np.linalg.norm(mid - c, axis=1) < r  # noqa: E731
    regions = {
        "skull": mid[:, 1] > HEAD_TOP_Y - 0.18,
        "face": near(lm["eye"], 0.07) | near(MIRROR @ lm["eye"], 0.07) | near(lm["mouth"], 0.05) | near(lm["bulb"], 0.04),
        "torso": (mid[:, 1] > 1.0) & (mid[:, 1] < 1.5) & (np.abs(mid[:, 0]) < 0.17),
        "legs": (mid[:, 1] > 0.15) & (mid[:, 1] < 0.85),
        "hands": np.abs(mid[:, 0]) > 0.8,
        "feet": mid[:, 1] < 0.1,
    }
    log("mean edge, mm: " + ", ".join(f"{k} {ln[m].mean() * 1000:.1f} ({m.sum() // 2})" for k, m in regions.items()))


# ---- The squeeze as a shape key ---------------------------------------------------


def tps_warp(src, dst, P):
    """Thin-plate (biharmonic, r) warp taking each src landmark to its dst, applied to P."""
    n = len(src)
    K = np.linalg.norm(src[:, None] - src[None], axis=2)
    A = np.zeros((n + 4, n + 4))
    A[:n, :n] = K
    A[:n, n] = 1
    A[:n, n + 1 :] = src
    A[n, :n] = 1
    A[n + 1 :, :n] = src.T
    rhs = np.zeros((n + 4, 3))
    rhs[:n] = dst - src
    sol = np.linalg.solve(A, rhs)
    Kp = np.linalg.norm(P[:, None] - src[None], axis=2)
    return P + Kp @ sol[:n] + sol[n] + P @ sol[n + 1 :]


def laplacian_smooth(D, F, movable, iters, lam=0.5):
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    deg = np.bincount(e[:, 0], minlength=len(D)).astype(float)[:, None]
    for _ in range(iters):
        s = np.zeros_like(D)
        np.add.at(s, e[:, 0], D[e[:, 1]])
        avg = s / np.maximum(deg, 1)
        D = np.where(movable[:, None], D + lam * (avg - D), D)
    return D


# The squeeze is zero below the neck's middle. The warp pins rings of the neck there,
# so the fade sits under them: a fade across the warp drew a ledge at the throat.
SQUEEZE_FROM_Y = 1.6
SQUEEZE_FULL_Y = 1.69


def squeeze_positions(V, F, lm, bare_ops):
    """The head's vertices go back onto the bare head (no eyes, nose or lips), a
    landmark warp takes that smooth surface into the ball, the crown and the back of the
    skull are pulled onto the ball, and the squeezed face is drawn on it as smooth bumps
    along the normals: sunken round eyes in rims, wrinkles, a small nose, a pursed mouth."""
    head = lm["head"]
    # Low on the neck only the neck itself moves, or the warp's overall shrink drags the
    # shoulders along; above the trapezius's top everything is head or neck.
    near_neck = 1 - smoothstep(0.075, 0.11, np.hypot(V[:, 0], V[:, 2] - 0.01))
    m = smoothstep(SQUEEZE_FROM_Y, SQUEEZE_FULL_Y, V[:, 1]) * np.maximum(near_neck, smoothstep(1.66, 1.71, V[:, 1]))
    mov = m > 0
    Bv = V.copy()

    def onto_bare(steps):
        for _ in range(steps):
            d = eval_points(bare_ops, Bv[mov])
            g = gradient(bare_ops, Bv[mov])
            Bv[mov] -= np.clip(d / np.maximum((g * g).sum(axis=1), 1e-6), -0.04, 0.04)[:, None] * g

    onto_bare(5)
    # The sockets' walls and the nose's sides land bunched on the bare head; a light
    # relax spreads them without losing the face's density.
    for _ in range(3):
        Bv = laplacian_smooth(Bv, F, mov, 1, lam=0.3)
        onto_bare(2)

    def on_head(x, u):
        return surface_hit([Op("add", head, 0.0)], [x, head_y(u), -0.05], [0, 0, 1])[0]

    def head_side(u):
        xo, zo, a, _ = head.at(head_y(u))
        return [xo + a, head_y(u), zo]

    pe, Re = lm["eye"], lm["eye_R"]
    se, sn = on_ball(SQ_EYE_X, SQ_EYE_Y)
    Rs = eye_frame(se, sn, SQ_EYE_TILT, 1)
    sm, smn = on_ball(0.0, SQ_MOUTH_Y)
    nose = on_ball(0.0, 1.95)[0]
    pairs = [
        (on_head(0.0, 0.25), on_ball(0.0, 2.10)[0]),
        (pe, se),
        (on_head(0.0, 0.69), nose),
        (lm["mouth"], sm),
        (lm["chin"], on_ball(0.0, SQ_CHIN_Y)[0]),
        # Under the jaw and the back of the lower head: tucked under the ball, so it
        # sits on the neck instead of tapering into it.
        ([0, 1.80, 0.12], [0, 1.842, 0.06]),
        ([0, 1.80, 0.065], [0, 1.832, 0.045]),
        ([0, head_y(1.03), 0.12], [0, 1.836, 0.052]),
        ([0, head_y(1.07), 0.055], [0, 1.775, 0.05]),
        ([0, head_y(0.95), -0.046], [0, 1.836, -0.05]),
        ([0, head_y(0.79), -0.115], [0, 1.88, -0.122]),
    ]
    sided = [
        (pe + Re[:, 0] * 0.068, se + Rs[:, 0] * SQ_EYE_L),
        (pe - Re[:, 0] * 0.068, se - Rs[:, 0] * SQ_EYE_L),
        (pe + Re[:, 1] * 0.0295, se + Rs[:, 1] * SQ_EYE_H),
        (pe - Re[:, 1] * 0.0295, se - Rs[:, 1] * SQ_EYE_H),
        (on_head(0.04, 0.82), on_ball(0.02, SQ_MOUTH_Y)[0]),
        (head_side(0.9), [0.072, 1.862, 0.0]),
        (head_side(0.97), [0.05, 1.838, 0.005]),
    ]
    # The skull goes to the ball along the same directions from each one's middle, so
    # the warp is already round; the face cone and the neck are left to the landmarks.
    centre = np.array([0.0, head_y(0.45), -0.02])
    bare_head = [Op("add", head, 0.0)]
    face_dir = unit([0, -0.3, 1])
    for lat in (-0.35, -0.1, 0.15, 0.4, 0.65, 0.88):
        for deg in (0, 30, 60, 90, 120, 150, 180):
            th = math.radians(deg)
            d = np.array([math.sqrt(1 - lat * lat) * math.sin(th), lat, math.sqrt(1 - lat * lat) * math.cos(th)])
            if d @ face_dir > 0.45:
                continue
            p, _ = surface_hit(bare_head, centre, d)
            q = SQ_CENTER + d / np.linalg.norm(d / SQ_RADII)
            if deg in (0, 180):
                pairs.append((p, q))
            else:
                sided.append((p, q))
    pairs.append((surface_hit(bare_head, centre, [0, 1, 0])[0], SQ_CENTER + [0, SQ_RADII[1], 0]))
    for a_, b_ in sided:
        pairs.append((a_, b_))
        pairs.append((MIRROR @ np.asarray(a_, float), MIRROR @ np.asarray(b_, float)))
    for y in (1.62, 1.69):
        for d in ([0.05, 0, 0], [-0.05, 0, 0], [0, 0, 0.055], [0, 0, -0.05]):
            p = np.array([d[0], y, d[2]])
            pairs.append((p, p))
    src = np.array([np.asarray(a_, float) for a_, _ in pairs])
    dst = np.array([np.asarray(b_, float) for _, b_ in pairs])
    P = Bv.copy()
    P[mov] = tps_warp(src, dst, Bv[mov])
    stages = {"bare": Bv.copy(), "warp": P.copy()}

    # The crown, sides and back pulled onto the ball, by direction from its centre: none
    # on the face (the warp placed it) and none under the jaw, where the neck goes in.
    q = (P - SQ_CENTER) / SQ_RADII
    qn = q / np.maximum(np.linalg.norm(q, axis=1), 1e-6)[:, None]
    ball = SQ_CENTER + SQ_RADII * qn
    crown = smoothstep(0.45, -0.05, qn @ unit([0, -0.25, 1])) * smoothstep(-0.8, -0.5, qn[:, 1])
    P = np.where(mov[:, None], P + (ball - P) * crown[:, None], P)
    stages["ball"] = P.copy()

    # The squeezed face's own features. They are broad on purpose: the normal head's
    # triangles carry them, and a narrow rim or wrinkle came out jagged.
    N = vertex_normals(P, F)
    bump = np.zeros(len(P))
    for R, e in ((Rs, se), (MIRROR @ Rs, MIRROR @ se)):
        rel = P - e
        rho = np.hypot((rel @ R[:, 0]) / SQ_EYE_L, (rel @ R[:, 1]) / SQ_EYE_H)
        eye = -SQ_EYE_SINK * (1 - smoothstep(0.7, 1.05, rho)) + SQ_EYE_BULGE * np.maximum(1 - rho * rho, 0)
        rim = SQ_RIM * np.exp(-(((rho - 1.32) / 0.3) ** 2))
        bump += (eye + rim) * smoothstep(-0.035, 0.0, rel @ R[:, 2])
    face = smoothstep(0.04, 0.08, P[:, 2])
    near = lambda c, s: np.exp(-((np.linalg.norm(P - c, axis=1) / s) ** 2))  # noqa: E731
    for s in (1, -1):
        bump += 0.005 * near(on_ball(0.022 * s, 2.06)[0], 0.013) * face
    bump += 0.006 * near(nose, 0.011)
    mouth = sm + smn * SQ_MOUTH_PUSH
    bump += SQ_MOUTH_PUSH * near(sm, 0.021) * face
    dm = np.linalg.norm(P - mouth, axis=1)
    bump += 0.004 * np.exp(-(((dm - 0.011) / 0.005) ** 2)) * face
    bump -= 0.004 * near(mouth, 0.0045) * face
    bump += 0.004 * near(on_ball(0.0, SQ_CHIN_Y)[0], 0.014)
    for s in (1, -1):
        bump += 0.005 * near(on_ball(0.062 * s, 1.905)[0], 0.022)
    # Only the bumps are smoothed: smoothing the whole move from the normal head would
    # hand each vertex some of its neighbours' socket and nose depth back.
    bump = laplacian_smooth((bump * mov)[:, None], F, mov, 2)[:, 0]
    P = P + N * bump[:, None]
    # The throat has no features of its own, so there the whole move can be smoothed:
    # the warp squeezes it between the pinned neck and the tucked-in chin.
    throat = mov & (V[:, 1] < 1.86) & (np.hypot(V[:, 0], V[:, 2] - 0.03) < 0.12)
    P = V + laplacian_smooth(P - V, F, throat, 8)
    log(f"squeeze: {mov.sum()} vertices move, up to {np.linalg.norm(P - V, axis=1).max() * 100:.1f} cm")
    if "--debug-squeeze" in ARGS:
        np.savez(OUT / "squeeze-stages.npz", V=V, F=F, **stages)
    return V + (P - V) * m[:, None]


# ---- Weights, export ----------------------------------------------------------------


def read_weights(obj):
    me = obj.data
    names = {g.index: g.name for g in obj.vertex_groups}
    bones = np.zeros((len(me.vertices), 4), np.uint8)
    weights = np.zeros((len(me.vertices), 4), np.uint8)
    unweighted = 0
    for v in me.vertices:
        gs = sorted(((g.weight, BONE_INDEX[names[g.group]]) for g in v.groups if names[g.group] in BONE_INDEX and g.weight > 0), reverse=True)[:4]
        if not gs:
            unweighted += 1
            gs = [(1.0, BONE_INDEX["chest"])]
        total = sum(w for w, _ in gs)
        q = [w / total * 255 for w, _ in gs]
        ints = [int(math.floor(x)) for x in q]
        # Largest remainders take the rounding so every vertex sums to 255.
        for i in sorted(range(len(q)), key=lambda i: q[i] - ints[i], reverse=True)[: 255 - sum(ints)]:
            ints[i] += 1
        for i, ((_, b), w) in enumerate(zip(gs, ints)):
            bones[v.index, i] = b
            weights[v.index, i] = w
    if unweighted:
        log(f"warning: {unweighted} vertices had no bone weight and went to the chest")
    return bones, weights


def write_bin(path, V, N, bones, weights, S, NS, F):
    if len(V) > 65535:
        raise SystemExit(f"alien.bin: {len(V)} vertices do not fit uint16 indices")
    q = lambda n: np.concatenate([np.round(n * 127), np.zeros((len(n), 1))], axis=1).astype(np.int8)  # noqa: E731
    with open(path, "wb") as f:
        f.write(b"ALM1")
        f.write(struct.pack("<II", len(V), len(F)))
        f.write(V.astype("<f4").tobytes())
        f.write(q(N).tobytes())
        f.write(bones.astype(np.uint8).tobytes())
        f.write(weights.astype(np.uint8).tobytes())
        f.write(S.astype("<f4").tobytes())
        f.write(q(NS).tobytes())
        f.write(F.astype("<u2").tobytes())


# ---- Renders --------------------------------------------------------------------------

# The scene's wire look (src/render/scenes/alien/glsl.ts, MESH_FRAG), in Cycles.
WIRE_NEAR = (0.16, 1.0, 0.26)
RIM = (0.1, 1.0, 0.22)
SOLID_GREEN = (0.30, 0.62, 0.26)


def wire_material():
    mat = bpy.data.materials.new("wire")
    if hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    N = lambda t, **kw: nt.nodes.new(t)  # noqa: E731
    out = N("ShaderNodeOutputMaterial")
    emit = N("ShaderNodeEmission")
    wire = N("ShaderNodeWireframe")
    wire.use_pixel_size = True
    wire.inputs["Size"].default_value = 1.6
    lw = N("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    rim = N("ShaderNodeMath")
    rim.operation = "POWER"
    rim.inputs[1].default_value = 2.0
    nt.links.new(lw.outputs["Facing"], rim.inputs[0])
    outline = N("ShaderNodeMapRange")
    outline.interpolation_type = "SMOOTHSTEP"
    outline.inputs["From Min"].default_value = 0.6
    outline.inputs["From Max"].default_value = 0.93
    nt.links.new(lw.outputs["Facing"], outline.inputs["Value"])
    o2 = N("ShaderNodeMath")
    o2.operation = "MULTIPLY"
    nt.links.new(outline.outputs["Result"], o2.inputs[0])
    nt.links.new(outline.outputs["Result"], o2.inputs[1])
    # fill = 0.008 + 0.3 rim + 1.1 outline^2
    f1 = N("ShaderNodeMath")
    f1.operation = "MULTIPLY_ADD"
    nt.links.new(rim.outputs[0], f1.inputs[0])
    f1.inputs[1].default_value = 0.3
    f1.inputs[2].default_value = 0.008
    f2 = N("ShaderNodeMath")
    f2.operation = "MULTIPLY_ADD"
    nt.links.new(o2.outputs[0], f2.inputs[0])
    f2.inputs[1].default_value = 1.1
    nt.links.new(f1.outputs[0], f2.inputs[2])
    # wire strength = wire * (0.62 + 0.8 rim)
    w1 = N("ShaderNodeMath")
    w1.operation = "MULTIPLY_ADD"
    nt.links.new(rim.outputs[0], w1.inputs[0])
    w1.inputs[1].default_value = 0.8
    w1.inputs[2].default_value = 0.62
    w2 = N("ShaderNodeMath")
    w2.operation = "MULTIPLY"
    nt.links.new(wire.outputs["Fac"], w2.inputs[0])
    nt.links.new(w1.outputs[0], w2.inputs[1])
    cf = N("ShaderNodeVectorMath")
    cf.operation = "SCALE"
    cf.inputs[0].default_value = RIM
    nt.links.new(f2.outputs[0], cf.inputs["Scale"])
    cw = N("ShaderNodeVectorMath")
    cw.operation = "SCALE"
    cw.inputs[0].default_value = WIRE_NEAR
    nt.links.new(w2.outputs[0], cw.inputs["Scale"])
    add = N("ShaderNodeVectorMath")
    add.operation = "ADD"
    nt.links.new(cf.outputs["Vector"], add.inputs[0])
    nt.links.new(cw.outputs["Vector"], add.inputs[1])
    nt.links.new(add.outputs["Vector"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def camera(scene, name, yaw_deg, target, dist, ortho=None, lens=70, pitch_deg=0.0):
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    scene.collection.objects.link(cam)
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    tb = Vector(to_bl(target))
    off = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    cam.location = tb + off
    cam.rotation_euler = (math.pi / 2 - pitch, 0.0, yaw)
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho
    else:
        cam_data.lens = lens
    cam_data.clip_start, cam_data.clip_end = 0.05, 100
    return cam


def setup_solid(scene, bg=0.86):
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "SINGLE"
    sh.single_color = SOLID_GREEN
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.show_specular_highlight = True
    scene.world.color = (bg, bg, bg)
    scene.display.render_aa = "16"


def setup_wire(scene):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.world.color = (0, 0, 0)
    if scene.world.node_tree:
        for node in scene.world.node_tree.nodes:
            if node.type == "BACKGROUND":
                node.inputs["Color"].default_value = (0, 0, 0, 1)


def render_to(scene, cam, path, res):
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def render_all(scene, obj, arm, quick):
    RENDERS.mkdir(parents=True, exist_ok=True)
    scene.view_settings.view_transform = "Standard"
    obj.data.polygons.foreach_set("use_smooth", np.ones(len(obj.data.polygons), bool))
    wire = wire_material()
    obj.data.materials.clear()
    obj.data.materials.append(wire)
    key = obj.data.shape_keys.key_blocks["Squeeze"] if obj.data.shape_keys else None
    body_c = [0.0, 1.22, 0.0]
    head_c = [0.0, HEAD_CHIN_Y + HEAD_H * 0.45, 0.02]
    views = [("front", 0.0), ("side", 90.0), ("three-quarter", 38.0)]
    res_body, res_head = ((600, 600), (500, 500)) if quick else ((1100, 1100), (900, 900))
    shots = []
    for vname, yaw in views:
        o = None if vname == "three-quarter" else 2.75
        shots.append(("body", vname, camera(scene, f"body-{vname}", yaw, body_c, 9.0 if o else 4.9, ortho=o, lens=55, pitch_deg=4 if o is None else 0), res_body))
        oh = None if vname == "three-quarter" else 0.82
        shots.append(("head", vname, camera(scene, f"head-{vname}", yaw, head_c, 4.0 if oh else 2.5, ortho=oh, lens=110, pitch_deg=4 if oh is None else 0), res_head))
    for look in ("solid", "wire"):
        (setup_solid if look == "solid" else setup_wire)(scene)
        for part, vname, cam, res in shots:
            for squeezed in (False, True):
                if part == "body" and squeezed and vname != "three-quarter":
                    continue
                if key:
                    key.value = 1.0 if squeezed else 0.0
                tag = "-squeezed" if squeezed else ""
                render_to(scene, cam, RENDERS / f"{part}-{vname}-{look}{tag}.png", res)
        log(f"{look} renders done")
    if key:
        key.value = 0.0

    # Posed checks: arms down and the head nodded 30 degrees forward, so the shoulders
    # and neck can be seen bending on the automatic weights.
    pose_checks(scene, arm, obj, quick)


def pose_checks(scene, arm, obj, quick):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones

    def turn(name, axis, deg):
        b = pb[name]
        head = Vector(b.head)
        R = Matrix.Rotation(math.radians(deg), 4, axis)
        b.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ b.matrix
        bpy.context.view_layer.update()

    turn("L_upperArm", "Y", 80)
    turn("R_upperArm", "Y", -80)
    turn("head", "X", 30)
    bpy.ops.object.mode_set(mode="OBJECT")
    res = (600, 600) if quick else (1000, 1000)
    for look in ("solid", "wire"):
        (setup_solid if look == "solid" else setup_wire)(scene)
        for vname, yaw in (("front", 0.0), ("side", 90.0), ("three-quarter", 38.0)):
            cam = camera(scene, f"posed-{vname}", yaw, [0.0, 1.72, 0.05], 4.0 if vname != "three-quarter" else 3.4, ortho=1.6 if vname != "three-quarter" else None, lens=60, pitch_deg=0 if vname != "three-quarter" else 6)
            render_to(scene, cam, RENDERS / f"posed-{vname}-{look}.png", res)
    log("posed renders done")


# ---- Main ---------------------------------------------------------------------------------


def main():
    scene = reset_scene()
    arm = build_armature(scene)
    log(f"armature: {len(BONES)} bones")

    body = body_ops()
    hops, head_lm = head_ops()
    ops = body + hops
    log(f"field: {len(ops)} parts")
    V, F = mesh_field(ops, [-1.12, -0.03, -0.36], [1.12, 2.5, 0.36], VOXEL)
    V, F = keep_largest_component(V, F)
    if signed_volume(V, F) < 0:
        F = F[:, ::-1].copy()
    log(f"one surface: {len(V)} vertices, {len(F)} triangles, volume {signed_volume(V, F) * 1000:.1f} L")
    if "--dump-raw" in ARGS:
        np.savez(OUT / "raw.npz", V=V, F=F)

    obj = make_mesh_object(scene, "alien", V, F)
    sm = obj.modifiers.new("smooth", "SMOOTH")
    sm.factor, sm.iterations = 0.5, 2
    apply_modifier(obj, sm)

    Vs, _ = mesh_arrays(obj)
    vg = obj.vertex_groups.new(name="density")
    w = density(Vs, head_lm)
    for val in np.unique(np.round(w, 2)):
        idx = np.flatnonzero(np.round(w, 2) == val)
        if val > 0:
            vg.add(idx.tolist(), float(val), "REPLACE")
    tris_before = len(obj.data.polygons)
    dec = obj.modifiers.new("decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = TARGET_TRIS / tris_before
    dec.use_collapse_triangulate = True
    dec.use_symmetry = "--no-sym" not in ARGS
    dec.symmetry_axis = "X"
    # Blender reads the group as where it may collapse freely, so the density
    # (where to keep triangles) goes in inverted.
    dec.vertex_group = "density"
    dec.invert_vertex_group = True
    dec.vertex_group_factor = DENSITY_FACTOR
    apply_modifier(obj, dec)
    obj.vertex_groups.remove(obj.vertex_groups["density"])
    V, F = mesh_arrays(obj)
    log(f"decimated: {len(V)} vertices, {len(F)} triangles")
    # Decimation leaves a few folded triangles and slivers, bright specks in the wire:
    # relax gently, each round snapped back onto the field's surface.
    everyone = np.ones(len(V), bool)
    for _ in range(3):
        V = laplacian_smooth(V, F, everyone, 1, lam=0.3)
        for _ in range(2):
            g = gradient(ops, V)
            V -= np.clip(eval_points(ops, V) / np.maximum((g * g).sum(axis=1), 1e-6), -0.01, 0.01)[:, None] * g
    obj.data.vertices.foreach_set("co", to_bl(V).astype(np.float32).ravel())
    obj.data.update()
    edge_report(V, F, head_lm)

    S = squeeze_positions(V, F, head_lm, body + [hops[0]])
    obj.shape_key_add(name="Basis")
    key = obj.shape_key_add(name="Squeeze")
    key.data.foreach_set("co", to_bl(S).astype(np.float32).ravel())

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    bones, weights = read_weights(obj)
    log("weights done")

    N = vertex_normals(V, F)
    NS = vertex_normals(S, F)
    delta = S - V
    write_bin(OUT / "alien.bin", V, N, bones, weights, delta, NS, F)
    size = (OUT / "alien.bin").stat().st_size
    log(f"alien.bin: {len(V)} vertices, {len(F)} triangles, {size} bytes, squeeze up to {np.linalg.norm(delta, axis=1).max() * 100:.1f} cm")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "alien.blend"))
    if RENDER:
        render_all(scene, obj, arm, QUICK)
    log("done")


main()
