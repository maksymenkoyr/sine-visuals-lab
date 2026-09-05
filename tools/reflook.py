"""
reflook: measure the *picture* of a reference video as structure, not
statistics — the half of tools/ref-scan.py that answers "what is drawn":
how many lit objects, what shapes, how big at what distance from the
centre, how thick the strokes, how far the glow reaches, what colours, and
how it all moves. ref-scan.py calls measure_look() once per visual regime
and writes the result into the bundle as

    report.md   "## Picture, measured": one block per regime, numbers first
    look.json   every detected object (r, angle, size, class, hue, stroke…)
    look.png    per regime: the full-resolution frame, a centre crop, and
                the detection overlay (contours coloured by shape class) —
                the check that the numbers describe what you would see

Coordinates: r is the distance from the frame centre in half-heights (r = 1
at the top/bottom edge), angles in degrees counter-clockwise from +x on
screen. Object sizes are the major axis in the same units; strokes and
glow are pixels of the decoded frame, stated with the frame size.

Why full resolution here when ref-scan.py decodes at a 480×270 budget: a
neon stroke is 2-6 px at 720p — at 480 wide it is under a pixel and the
line and its glow merge into one blob. Only a few frames per clip are
measured this way (one per regime, plus a short window for optical flow),
so the cost stays small.

What each measurement is for, when adapting the look:
  objects / classes / hollow share   what to draw, and whether as outlines or fills
  size ∝ r^b                          b ≈ 1 is a perspective tunnel (size grows
                                      with distance from the vanishing point);
                                      b ≈ 0 is a flat pattern
  rings, fold, on-axis share          where things sit: how many depth rings are
                                      visible at once, rotational multiplicity,
                                      cardinal vs diagonal placement
  stroke inner/outer, glow e-fold     line width in px near the centre vs the
                                      edge, and the bloom radius in px
  hues                                the palette as hue angles with shares
  ground, vignette                    the black: its colour, and centre/edge
  flow p, v, rotation                 radial speed ∝ r^p: p ≈ 1 is a flat
                                      pattern being scaled (a zoom); p ≈ 2 is
                                      a fly-through along the axis (a ring at
                                      depth z sits at r ∝ 1/z and moves at
                                      dr/dt ∝ r²); its magnitude, and the spin
  streak elongation                   motion-blur length: how stretched objects
                                      are along the radial direction at the
                                      edge vs the centre
"""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import cv2
import numpy as np

FLOW_W = 640  # optical-flow working width
FLOW_FRAMES = 12  # frames at FLOW_FPS around the regime's representative
FLOW_FPS = 30
MIN_AREA_FRAC = 1.5e-5  # smallest object kept, as a share of frame pixels (14 px at 720p)
THR_FLOOR = 0.18  # luminance floor for "lit"
RIDGE_PX = 9  # neighbourhood for the local-maximum test — about a stroke plus its near halo
RIDGE_FRAC = 0.45  # lit = within this fraction of the local maximum (a halo sits well below)
CONTRAST_SIGMA = 20  # px; the surroundings a lit pixel must stand above
CONTRAST_MIN = 0.06  # by at least this much luminance
ARROW_SCALE = 6  # track arrows in the overlay are drawn this many steps long
TRACK_DT = 1 / FLOW_FPS  # frame pair spacing for object tracking
TRACK_MAX_MOVE = 0.06  # a match may move at most this×(1+r) half-heights in one step
TRACK_MAX_TURN = 4.0  # degrees of angular change allowed per step (the spin, plus slack)
GATE_CLASSES = ("hex ring", "frame", "ring", "panel", "disc")  # the compact objects the perspective law is fitted on
GLOW_RINGS = (1, 2, 4, 8, 16, 32)  # distances outside the lit mask, px
GROUND_DIST = 40  # px away from anything lit counts as ground
RING_GAP = 0.06  # objects closer in r than this×(1+r) share a ring
AXIS_TOL = 0.15  # share of the fold period that counts as "on" an axis
HUE_NAMES = ["red", "orange", "yellow", "chartreuse", "green", "spring", "cyan", "azure", "blue", "violet", "magenta", "rose"]
CLASS_COLOURS = {
    "hex ring": (0, 255, 200), "frame": (80, 160, 255), "ring": (200, 255, 80), "bar": (255, 120, 0),
    "panel": (255, 60, 200), "disc": (255, 255, 0), "blob": (160, 160, 160),
}


# ---- frames ----------------------------------------------------------------------


def decode_at(src: Path, t: float, w: int, h: int, n: int = 1, fps: float = FLOW_FPS) -> np.ndarray:
    """`n` frames from `t` at `fps`, RGB, w×h."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(src), "-frames:v", str(n),
         "-vf", f"fps={fps},scale={w}:{h}", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
        capture_output=True, check=False,
    ).stdout
    k = len(raw) // (w * h * 3)
    return np.frombuffer(raw[: k * w * h * 3], dtype=np.uint8).reshape(k, h, w, 3)


def luminance(rgb: np.ndarray) -> np.ndarray:
    f = rgb.astype(np.float32) / 255.0
    return 0.2126 * f[..., 0] + 0.7152 * f[..., 1] + 0.0722 * f[..., 2]


def lit_mask(lum: np.ndarray) -> tuple[np.ndarray, float]:
    """The neon cores: a pixel is lit when it is above a floor set from the
    frame's dark level *and* within RIDGE_FRAC of the brightest pixel in its
    neighbourhood — so a line's own halo (a fraction of its core) stays out
    however bright the bloom, while a dim far object, brightest in its own
    patch, stays in."""
    floor = max(THR_FLOOR, float(np.percentile(lum, 20)) + 0.12)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (RIDGE_PX, RIDGE_PX))
    local_max = cv2.dilate(lum, k)
    # Haze and bloom are flat: a lit pixel must also stand above its wider
    # surroundings, which a broad glow does not.
    contrast = lum - cv2.GaussianBlur(lum, (0, 0), CONTRAST_SIGMA)
    return (lum > floor) & (lum > RIDGE_FRAC * local_max) & (contrast > CONTRAST_MIN), floor


# ---- objects ---------------------------------------------------------------------


def hue_name(deg: float) -> str:
    return HUE_NAMES[int(((deg + 15) % 360) // 30)]


def classify(hollow: bool, verts: int, elong: float) -> str:
    if elong > 3.0:
        return "bar"
    if hollow:
        if 5 <= verts <= 7:
            return "hex ring"
        if verts == 4:
            return "frame"
        return "ring"
    if verts == 4:
        return "panel"
    if verts >= 8:
        return "disc"
    return "blob"


def describe_objects(rgb: np.ndarray, mask: np.ndarray) -> list[dict]:
    H, W = mask.shape
    cx0, cy0, half = W / 2, H / 2, H / 2
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    n, lab, stats, cents = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    min_area = max(6, MIN_AREA_FRAC * W * H)
    out = []
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        x, y, bw, bh = (int(stats[i, k]) for k in (cv2.CC_STAT_LEFT, cv2.CC_STAT_TOP, cv2.CC_STAT_WIDTH, cv2.CC_STAT_HEIGHT))
        comp = (lab[y : y + bh, x : x + bw] == i).astype(np.uint8)
        contours, hier = cv2.findContours(comp, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        outer_i = max(range(len(contours)), key=lambda k: cv2.contourArea(contours[k]))
        outer = contours[outer_i]
        holes = 0.0
        if hier is not None:
            for k, hrow in enumerate(hier[0]):
                if hrow[3] == outer_i:
                    holes += cv2.contourArea(contours[k])
        enclosed = area + holes
        hollow = holes > 0.25 * enclosed
        peri = cv2.arcLength(outer, True)
        verts = len(cv2.approxPolyDP(outer, 0.03 * peri, True)) if peri > 0 else 0
        if len(outer) >= 5:
            (ex, ey), (ax1, ax2), ang = cv2.fitEllipse(outer)
            major, minor = max(ax1, ax2), max(1e-3, min(ax1, ax2))
            # fitEllipse's angle is the minor axis' bearing in image coords (y down)
            major_ang = math.radians(ang + (90.0 if ax1 < ax2 else 0.0))
        else:
            major, minor = float(max(bw, bh)), float(max(1, min(bw, bh)))
            major_ang = 0.0 if bw >= bh else math.pi / 2
        elong = major / minor
        cx, cy = float(cents[i][0]), float(cents[i][1])
        dx, dy = cx - cx0, cy - cy0
        r = math.hypot(dx, dy) / half
        theta = math.degrees(math.atan2(-dy, dx)) % 360.0  # screen ccw, y up
        radial_dir = math.atan2(dy, dx)  # image coords, y down — same frame as major_ang
        radial_align = abs(math.cos(major_ang - radial_dir))
        sel = comp > 0
        hh = hsv[y : y + bh, x : x + bw][sel]
        wts = (hh[:, 1].astype(np.float32) / 255.0) * (hh[:, 2].astype(np.float32) / 255.0) + 1e-6
        hue_rad = hh[:, 0].astype(np.float32) * (2 * math.pi / 180.0)
        hue = math.degrees(math.atan2(np.sum(wts * np.sin(hue_rad)), np.sum(wts * np.cos(hue_rad)))) % 360.0
        sat = float(np.average(hh[:, 1] / 255.0, weights=wts))
        if hollow:
            dt = cv2.distanceTransform(comp, cv2.DIST_L2, 3)
            stroke = float(2.0 * np.median(dt[sel]))
        else:
            stroke = float(minor)
        out.append({
            "_r": r, "_theta": theta, "_half": half,
            "r": round(r, 3), "theta": round(theta, 1), "size": round(major / half, 4), "elong": round(elong, 2),
            "radialAlign": round(radial_align, 2), "areaPx": area, "hollow": bool(hollow), "verts": int(verts),
            "class": classify(hollow, verts, elong), "hue": round(hue, 1), "sat": round(sat, 2),
            "strokePx": round(stroke, 1), "bbox": [x, y, bw, bh], "cx": round(cx, 1), "cy": round(cy, 1),
        })
    return out


# ---- aggregates ------------------------------------------------------------------


def fit_power(xs: np.ndarray, ys: np.ndarray) -> tuple[float, float] | None:
    ok = (xs > 0) & (ys > 0)
    if ok.sum() < 4:
        return None
    b, a = np.polyfit(np.log(xs[ok]), np.log(ys[ok]), 1)
    return float(b), float(a)


def find_rings(objs: list[dict]) -> list[dict]:
    """Peaks of the object-count density along r (log-spaced bins, since a
    tunnel's rings crowd toward the centre): each peak is a depth ring, with
    the number of objects it holds."""
    rs = np.array([o["r"] for o in objs if o["r"] > 0.02])
    if len(rs) < 3:
        return []
    edges = np.exp(np.linspace(np.log(0.02), np.log(2.0), 41))
    hist, _ = np.histogram(rs, bins=edges)
    sm = np.convolve(hist.astype(float), [0.25, 0.5, 0.25], mode="same")
    mids = np.sqrt(edges[:-1] * edges[1:])
    out = []
    for i in range(1, len(sm) - 1):
        if sm[i] >= sm[i - 1] and sm[i] > sm[i + 1] and sm[i] >= max(1.0, 0.15 * sm.max()):
            lo, hi = edges[max(0, i - 1)], edges[min(len(edges) - 1, i + 2)]
            out.append({"r": round(float(mids[i]), 2), "n": int(((rs >= lo) & (rs < hi)).sum())})
    return out


def estimate_fold(objs: list[dict]) -> tuple[int, float]:
    """Largest rotational multiplicity under which most objects have a
    partner at the same r, rotated by one period."""
    pts = [(o["r"], o["theta"]) for o in objs if o["r"] > 0.04]
    if len(pts) < 4:
        return 1, 0.0
    best = (1, 0.0)
    for f in range(2, 9):
        per = 360.0 / f
        hit = 0
        for r, th in pts:
            t2 = (th + per) % 360.0
            if any(abs(r2 - r) < 0.08 * (1 + r) and min(abs(th2 - t2), 360 - abs(th2 - t2)) < 8.0 for r2, th2 in pts):
                hit += 1
        score = hit / len(pts)
        if score >= 0.6 and score >= best[1] - 0.05:
            best = (f, score)
    return best


def axis_shares(objs: list[dict], fold: int) -> tuple[float, float]:
    if fold < 2 or not objs:
        return 0.0, 0.0
    per = 360.0 / fold
    on, diag = 0, 0
    for o in objs:
        ph = o["theta"] % per
        d_axis = min(ph, per - ph)
        d_diag = abs(ph - per / 2)
        if d_axis < AXIS_TOL * per:
            on += 1
        elif d_diag < AXIS_TOL * per:
            diag += 1
    return on / len(objs), diag / len(objs)


def hue_clusters(objs: list[dict]) -> list[dict]:
    if not objs:
        return []
    bins = np.zeros(12)
    for o in objs:
        if o["sat"] < 0.15:
            continue
        bins[int(((o["hue"] + 15) % 360) // 30)] += o["areaPx"]
    tot = bins.sum()
    if tot <= 0:
        return [{"name": "white", "deg": 0, "share": 1.0}]
    order = np.argsort(-bins)
    return [{"name": HUE_NAMES[i], "deg": int(i * 30), "share": round(float(bins[i] / tot), 2)} for i in order[:4] if bins[i] / tot >= 0.05]


def glow_profile(lum: np.ndarray, mask: np.ndarray) -> dict:
    """Mean luminance at rings of distance outside the lit mask, and the
    e-fold length of an exponential fitted to it above the ground level."""
    dist = cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 3)
    ground = float(lum[dist > GROUND_DIST].mean()) if np.any(dist > GROUND_DIST) else 0.0
    core = float(lum[mask].mean()) if mask.any() else 1.0
    prof = []
    for d in GLOW_RINGS:
        sel = (dist >= d) & (dist < d * 1.4 + 0.5)
        prof.append(float(lum[sel].mean()) if sel.any() else ground)
    ds = np.array(GLOW_RINGS, dtype=np.float64)
    ys = np.array(prof) - ground
    ok = ys > 0.01
    efold = None
    if ok.sum() >= 3:
        slope, _ = np.polyfit(ds[ok], np.log(ys[ok]), 1)
        if slope < 0:
            efold = float(-1.0 / slope)
    return {"ground": round(ground, 4), "core": round(core, 3), "profile": [round(p, 4) for p in prof],
            "efoldPx": None if efold is None else round(efold, 1),
            "haloRatio": round(float((prof[2] - ground) / max(1e-3, core - ground)), 3)}


def ground_colour(rgb: np.ndarray, lum: np.ndarray, mask: np.ndarray) -> dict:
    H, W = mask.shape
    dist = cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 3)
    far = dist > GROUND_DIST
    yy, xx = np.mgrid[0:H, 0:W]
    rr = np.hypot(yy - H / 2, xx - W / 2) / (H / 2)
    if not far.any():
        return {"hex": "#000000", "vignette": 1.0}
    c = rgb[far].mean(axis=0).astype(int)
    inner, outer = far & (rr < 0.35), far & (rr > 0.75)
    vig = float(lum[inner].mean() / max(1e-4, lum[outer].mean())) if inner.any() and outer.any() else 1.0
    return {"hex": "#%02x%02x%02x" % tuple(c), "vignette": round(vig, 2)}


def track_objects(a: list[dict], b: list[dict]) -> list[tuple[dict, dict]]:
    """Match objects of frame a to frame b (one step apart): a candidate must
    be close, similar in size and hue, and displaced along its radial line
    (a tunnel or a zoom moves things radially; the spin adds at most a few
    degrees per step). One-to-one, closest first."""
    pairs = []
    cand = []
    for i, o in enumerate(a):
        for j, p in enumerate(b):
            dpos = math.hypot(o["cx"] - p["cx"], o["cy"] - p["cy"])
            lim = TRACK_MAX_MOVE * (1 + o["_r"]) * o["_half"]
            if dpos > lim:
                continue
            dsize = abs(math.log((p["size"] + 1e-4) / (o["size"] + 1e-4)))
            dhue = min(abs(p["hue"] - o["hue"]), 360 - abs(p["hue"] - o["hue"]))
            if dsize > 0.35 or dhue > 30:
                continue
            dth = abs((p["_theta"] - o["_theta"] + 540) % 360 - 180)
            if dth > TRACK_MAX_TURN:
                continue
            cand.append((dpos / lim + dsize + dth / TRACK_MAX_TURN, i, j))
    used_a, used_b = set(), set()
    for _, i, j in sorted(cand):
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        pairs.append((a[i], b[j]))
    return pairs


def flow_profile(frames: np.ndarray) -> tuple[dict | None, list[tuple[dict, dict]]]:
    """Motion from tracking the lit objects between consecutive frames: each
    match gives a radial speed (half-heights/s, + = outward) and an angular
    speed (°/s, + = counter-clockwise on screen) at its r. Binned by r, with
    a power-law fit of |radial speed| against r. Also returns the matches of
    the middle frame pair, for the overlay's arrows."""
    if len(frames) < 2:
        return None, []
    per_frame = []
    for f in frames:
        lum = luminance(f)
        mask, _ = lit_mask(lum)
        per_frame.append(describe_objects(f, mask))
    rs, vr, om = [], [], []
    mid_pairs: list[tuple[dict, dict]] = []
    mid = (len(per_frame) - 1) // 2
    for k, (a, b) in enumerate(zip(per_frame[:-1], per_frame[1:])):
        pairs = track_objects(a, b)
        if k == mid:
            mid_pairs = pairs
        for o, p in pairs:
            r0 = o["_r"]
            if r0 < 0.03:
                continue
            dr = (p["_r"] - o["_r"]) / TRACK_DT
            dth = (p["_theta"] - o["_theta"] + 540) % 360 - 180
            rs.append(r0)
            vr.append(dr)
            om.append(dth / TRACK_DT)
    if len(rs) < 6:
        return None, mid_pairs
    rs, vr, om = np.array(rs), np.array(vr), np.array(om)
    edges = np.array([0.03, 0.15, 0.3, 0.5, 0.75, 1.0, 1.5])
    mids = np.sqrt(edges[:-1] * edges[1:])
    vr_b = np.full(len(mids), np.nan)
    om_b = np.full(len(mids), np.nan)
    for k in range(len(mids)):
        sel = (rs >= edges[k]) & (rs < edges[k + 1])
        if sel.sum() >= 3:
            vr_b[k] = np.median(vr[sel])
            om_b[k] = np.median(om[sel])
    ok = ~np.isnan(vr_b)
    outward_share = float(np.mean(vr > 0))
    fit = fit_power(rs, np.abs(vr)) if len(rs) >= 4 else None
    return {
        "matches": int(len(rs)), "outwardShare": round(outward_share, 2),
        "rBins": [round(float(m), 2) for m in mids], "radial": [None if np.isnan(v) else round(float(v), 3) for v in vr_b],
        "rotDegS": [None if np.isnan(v) else round(float(v), 1) for v in om_b],
        "direction": "outward" if outward_share > 0.5 else "inward", "p": None if fit is None else round(fit[0], 2),
        "vAt05": None if fit is None else round(float(math.exp(fit[1]) * 0.5 ** fit[0]), 3),
        "rotMeanDegS": round(float(np.median(om)), 1),
    }, mid_pairs


# ---- one regime ------------------------------------------------------------------


def measure_frame(rgb: np.ndarray) -> dict:
    lum = luminance(rgb)
    mask, thr = lit_mask(lum)
    objs = describe_objects(rgb, mask)
    H, W = mask.shape
    classes: dict[str, int] = {}
    for o in objs:
        classes[o["class"]] = classes.get(o["class"], 0) + 1
    fold, fold_score = estimate_fold(objs)
    on_axis, on_diag = axis_shares(objs, fold)
    # The perspective law is fitted on the gates (GATE_CLASSES) when there are
    # enough of them, else on the substantial objects: streak fragments and
    # specks of bloom sit at every r at the same size and flatten the slope.
    gates = [o for o in objs if o["class"] in GATE_CLASSES and o["r"] > 0.05]
    big = [o for o in objs if o["areaPx"] >= np.median([q["areaPx"] for q in objs]) and o["r"] > 0.05] if objs else []
    fit_set, fit_on = (gates, "gates") if len(gates) >= 6 else (big, "substantial objects")
    rs = np.array([o["r"] for o in fit_set]) if fit_set else np.zeros(0)
    sizes = np.array([o["size"] for o in fit_set]) if fit_set else np.zeros(0)
    fit = fit_power(rs, sizes) if len(fit_set) else None
    # The envelope: how big the biggest things are at each distance — what a
    # perspective model must reproduce even when fragments flatten the fit.
    env = {}
    for lo, hi, key in ((0.1, 0.3, "r0.1-0.3"), (0.3, 0.6, "r0.3-0.6"), (0.6, 1.0, "r0.6-1.0"), (1.0, 2.0, "r>1")):
        s = [o["size"] for o in objs if lo <= o["r"] < hi]
        env[key] = round(float(np.percentile(s, 90)), 3) if len(s) >= 2 else None
    hollow = [o for o in objs if o["hollow"]]
    # 3D cue: an outline with another lit object inside its hole is a prism or
    # a frame seen with depth (the far face shows through the near one).
    nested = 0
    for o in hollow:
        x, y, bw, bh = o["bbox"]
        inner = [q for q in objs if q is not o and x < q["cx"] < x + bw and y < q["cy"] < y + bh and q["areaPx"] < o["areaPx"]]
        if inner:
            nested += 1
    inner = [o["strokePx"] for o in hollow if o["r"] < 0.45]
    outer = [o["strokePx"] for o in hollow if o["r"] >= 0.45]
    el_in = [o["elong"] for o in objs if o["r"] < 0.45]
    el_out = [o["elong"] for o in objs if o["r"] >= 0.45]
    radial_share = float(np.mean([o["radialAlign"] > 0.8 for o in objs if o["elong"] > 1.5])) if any(o["elong"] > 1.5 for o in objs) else 0.0
    return {
        "size": [W, H], "thr": round(thr, 3), "litShare": round(float(mask.mean()), 4), "n": len(objs), "classes": classes,
        "hollowShare": round(len(hollow) / len(objs), 2) if objs else 0.0,
        "nestedShare": round(nested / len(hollow), 2) if hollow else 0.0,
        "sizeFit": None if fit is None else {"b": round(fit[0], 2), "at03": round(float(math.exp(fit[1]) * 0.3 ** fit[0]), 3),
                                              "at09": round(float(math.exp(fit[1]) * 0.9 ** fit[0]), 3), "on": fit_on, "n": len(fit_set)},
        "sizeEnvelope": env,
        "rings": find_rings(objs), "fold": fold, "foldScore": round(fold_score, 2),
        "onAxis": round(on_axis, 2), "onDiag": round(on_diag, 2),
        "stroke": {"innerPx": round(float(np.median(inner)), 1) if inner else None, "outerPx": round(float(np.median(outer)), 1) if outer else None},
        "streak": {"innerElong": round(float(np.median(el_in)), 2) if el_in else None, "outerElong": round(float(np.median(el_out)), 2) if el_out else None,
                   "radialShare": round(radial_share, 2)},
        "hues": hue_clusters(objs), "glow": glow_profile(lum, mask), "ground": ground_colour(rgb, lum, mask),
        "objects": objs,
    }


def overlay(rgb: np.ndarray, objs: list[dict], tracks: list[tuple[dict, dict]] = (), track_scale: float = 1.0) -> np.ndarray:
    """Detections as boxes coloured by class, and the object tracks of one
    frame step as white arrows ARROW_SCALE steps long (track_scale maps the
    flow window's pixels onto this frame's)."""
    img = (rgb.astype(np.float32) * 0.35).astype(np.uint8)
    H, W = img.shape[:2]
    for o in objs:
        x, y, bw, bh = o["bbox"]
        col = CLASS_COLOURS.get(o["class"], (200, 200, 200))
        cv2.rectangle(img, (x, y), (x + bw, y + bh), col, 1)
        if bw * bh > 0.0008 * W * H:
            cv2.putText(img, f"{o['class'][:3]} {o['strokePx']:.0f}", (x, max(10, y - 3)), cv2.FONT_HERSHEY_PLAIN, 0.8, col, 1, cv2.LINE_AA)
    for o, p in tracks:
        x0, y0 = int(o["cx"] * track_scale), int(o["cy"] * track_scale)
        x1 = int(x0 + (p["cx"] - o["cx"]) * track_scale * ARROW_SCALE)
        y1 = int(y0 + (p["cy"] - o["cy"]) * track_scale * ARROW_SCALE)
        cv2.arrowedLine(img, (x0, y0), (x1, y1), (255, 255, 255), 1, cv2.LINE_AA, tipLength=0.3)
    cv2.drawMarker(img, (W // 2, H // 2), (255, 255, 255), cv2.MARKER_CROSS, 12, 1)
    for r in (0.25, 0.5, 0.75, 1.0):
        cv2.circle(img, (W // 2, H // 2), int(r * H / 2), (70, 70, 70), 1)
    return img


def strip_private(objs: list[dict]) -> list[dict]:
    return [{k: v for k, v in o.items() if not k.startswith("_")} for o in objs]


def centre_crop(rgb: np.ndarray, frac: float = 0.34, zoom: int = 3) -> np.ndarray:
    H, W = rgb.shape[:2]
    ch, cw = int(H * frac), int(H * frac * W / H)
    y0, x0 = (H - ch) // 2, (W - cw) // 2
    crop = rgb[y0 : y0 + ch, x0 : x0 + cw]
    return cv2.resize(crop, (cw * zoom, ch * zoom), interpolation=cv2.INTER_CUBIC)


def measure_look(src: Path, start: float, regimes: list[dict], width: int, height: int, bundle: Path) -> dict:
    """`regimes`: [{"t": clip seconds, "share": 0..1}, …]. Writes
    frames/look_<n>.jpg, frames/look_<n>_overlay.png, look.png and look.json;
    returns the per-regime summaries (objects included) for audio.json."""
    from PIL import Image, ImageDraw

    w = min(width, 1280) // 2 * 2
    h = int(round(height * w / width / 2)) * 2
    fw = FLOW_W
    fh = int(round(height * fw / width / 2)) * 2
    (bundle / "frames").mkdir(exist_ok=True)
    out, tiles = [], []
    for k, rg in enumerate(regimes, start=1):
        fr = decode_at(src, start + rg["t"], w, h, 1)
        if len(fr) == 0:
            continue
        rgb = fr[0]
        m = measure_frame(rgb)
        m.update({"regime": k, "t": round(rg["t"], 2), "share": round(rg.get("share", 0.0), 2)})
        win = decode_at(src, start + rg["t"] - (FLOW_FRAMES / 2) / FLOW_FPS, fw, fh, FLOW_FRAMES)
        m["flow"], tracks = flow_profile(win)
        frame_name, ov_name = f"frames/look_{k}.jpg", f"frames/look_{k}_overlay.png"
        Image.fromarray(rgb).save(bundle / frame_name, quality=92)
        ov = overlay(rgb, m["objects"], tracks, w / fw)
        m["objects"] = strip_private(m["objects"])
        Image.fromarray(ov).save(bundle / ov_name)
        m["frame"], m["overlay"] = frame_name, ov_name
        out.append(m)
        tiles.append((rgb, centre_crop(rgb), ov, m))
    if tiles:
        th = 270
        cols = []
        for rgb, crop, ov, m in tiles:
            row = []
            for im in (rgb, crop, ov):
                tw = int(im.shape[1] * th / im.shape[0])
                row.append(cv2.resize(im, (tw, th), interpolation=cv2.INTER_AREA))
            cols.append(row)
        widths = [max(r[c].shape[1] for r in cols) for c in range(3)]
        label_h = 34
        sheet = Image.new("RGB", (sum(widths) + 4 * 6, len(cols) * (th + label_h + 6) + 6), (18, 18, 22))
        d = ImageDraw.Draw(sheet)
        for i, (row, (_, _, _, m)) in enumerate(zip(cols, tiles)):
            y = 6 + i * (th + label_h + 6)
            x = 6
            for c, im in enumerate(row):
                sheet.paste(Image.fromarray(im), (x, y))
                x += widths[c] + 6
            cls = ", ".join(f"{n} {c}" for c, n in sorted(m["classes"].items(), key=lambda kv: -kv[1])[:4])
            fit = m["sizeFit"]
            d.text((8, y + th + 3), f"regime {m['regime']}  t {m['t']:.2f}s  {int(m['share'] * 100)}% of clip  |  {m['n']} objects: {cls}", fill=(255, 255, 255))
            d.text((8, y + th + 18), (f"size ∝ r^{fit['b']:.2f}  " if fit else "") + f"fold {m['fold']}  on-axis {int(m['onAxis'] * 100)}%  "
                   f"stroke {m['stroke']['innerPx']}/{m['stroke']['outerPx']} px  glow e-fold {m['glow']['efoldPx']} px   [frame | centre ×3 | detections]",
                   fill=(180, 200, 255))
        sheet.save(bundle / "look.png")
    (bundle / "look.json").write_text(json.dumps(out, indent=1))
    return {"regimes": [{k: v for k, v in m.items() if k != "objects"} for m in out]}


# ---- report text -----------------------------------------------------------------


def picture_lines(P: dict) -> list[str]:
    L = []
    for m in P.get("regimes", []):
        W, H = m["size"]
        L.append(f"### Regime {m['regime']} — {int(m['share'] * 100)}% of the clip, {m['t']:.2f}s — `{m['frame']}`, detections `{m['overlay']}`\n")
        cls = ", ".join(f"{n} {c}" for c, n in sorted(m["classes"].items(), key=lambda kv: -kv[1]))
        L.append(f"- {m['n']} lit objects on {W}×{H} (lit floor {m['thr']:.2f}, lit {m['litShare'] * 100:.1f}% of pixels): {cls or '—'}; "
                 f"outlines {int(m['hollowShare'] * 100)}%, fills {int((1 - m['hollowShare']) * 100)}%; "
                 f"{int(m.get('nestedShare', 0) * 100)}% of outlines have another lit object inside (a prism/frame seen with depth)")
        fit = m["sizeFit"]
        if fit:
            kind = "a perspective tunnel (size grows with distance from the vanishing point)" if fit["b"] > 0.6 else ("a flat pattern" if fit["b"] < 0.3 else "in between")
            L.append(f"- size ∝ r^{fit['b']:.2f} over {fit['n']} {fit['on']}: {fit['at03']:.3f} half-heights at r 0.3, {fit['at09']:.3f} at r 0.9 → {kind}")
        env = m.get("sizeEnvelope")
        if env:
            L.append("- largest objects (90th pct of size) by band: " + ", ".join(f"{k} → {('—' if v is None else f'{v:.3f}')}" for k, v in env.items()))
        rings = ", ".join(f"{rg['r']:.2f} (×{rg['n']})" for rg in m["rings"][:8])
        fold = f"{m['fold']}-fold (score {m['foldScore']:.2f})" if m["fold"] > 1 else "no rotational multiplicity found"
        L.append(f"- rings at r ≈ {rings or '—'}; {fold}; on the axes {int(m['onAxis'] * 100)}%, on the diagonals {int(m['onDiag'] * 100)}%")
        st, g = m["stroke"], m["glow"]
        L.append(f"- stroke (outlines): {st['innerPx']} px at r<0.45, {st['outerPx']} px at r≥0.45; glow e-fold {g['efoldPx']} px, "
                 f"halo/core {g['haloRatio']:.2f} at 4 px; core lum {g['core']:.2f}, ground lum {g['ground']:.3f}")
        hues = ", ".join(f"{h['name']} {h['deg']}° {int(h['share'] * 100)}%" for h in m["hues"])
        L.append(f"- hues (by lit area): {hues}; ground `{m['ground']['hex']}`, centre/edge ground brightness {m['ground']['vignette']:.2f}")
        f = m.get("flow")
        if f:
            p = (f"∝ r^{f['p']:.2f} (" + ("a fly-through along the axis" if f["p"] > 1.5 else "a flat zoom" if f["p"] > 0.6 else "not a zoom") + ")") if f["p"] is not None else "(no fit)"
            v = f"{f['vAt05']:.2f} half-heights/s at r 0.5" if f["vAt05"] is not None else ""
            prof = ", ".join(f"{r:.2f}:{'—' if x is None else f'{x:+.2f}'}" for r, x in zip(f["rBins"], f["radial"]))
            way = ("objects fly toward the camera" if f["outwardShare"] >= 0.6 else
                   "objects recede toward the vanishing point — the camera flies backward" if f["outwardShare"] <= 0.4 else "mixed directions")
            L.append(f"- flow ({f['matches']} object tracks, {int(f['outwardShare'] * 100)}% moving outward → {way}): radial speed {p} {v}; "
                     f"by r → {prof}; rotation {f['rotMeanDegS']:+.1f}°/s (+ = counter-clockwise on screen)")
        sk = m["streak"]
        L.append(f"- streak: median elongation {sk['innerElong']} at r<0.45 vs {sk['outerElong']} at r≥0.45; "
                 f"{int(sk['radialShare'] * 100)}% of elongated objects lie along the radial direction")
        L.append("")
    return L
