# Finds oil droplets as circles, because the drops are near-round and interior shading fools any
# region split. Candidates come from gradient voting on three contrast channels and from the
# distance map of the saturated-colour mask; a candidate survives only if real edges support most
# of its rim, and overlapping duplicates keep the best-supported circle.
# Radii are pixels at the frame's own width.
import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage.morphology import reconstruction

import drops as masks

MIN_R = 3.0
MAX_R = 300
N_RIM = 72               # rim samples for the support score
MIN_SUPPORT_LARGE = 0.55 # share of the rim that must sit on an edge, r >= 12 px
MIN_SUPPORT_SMALL = 0.70 # a small circle has few samples, so ask for more of them
SAME_CIRCLE = 0.50       # circles overlapping more than this share of the smaller one are one drop
WEAK_RIM = 0.72          # below this rim support, a circle must also show a colour step
MIN_STEP = 12.0          # CIE76 between inside and just outside that counts as a real colour step
NESTED_STEP = 14.0       # a circle inside a bigger drop needs a plain step to count as an inner drop
RIM_HUGGER_STEP = 25.0   # a tiny circle on a bigger rim needs this step, else it is a dimple

def channels(bgr):
    """Three contrast channels: droplets differ from paint and from each other in hue, not only in light."""
    lab = cv2.cvtColor(cv2.GaussianBlur(bgr, (0, 0), 1.0), cv2.COLOR_BGR2Lab)
    return [lab[..., 0], lab[..., 1], lab[..., 2]]

def edge_maps(bgr):
    """Gradient (gx, gy) of the strongest channel per pixel, in Lab units."""
    gs = []
    for c in channels(bgr):
        c = c.astype(np.float32)
        gs.append((cv2.Scharr(c, cv2.CV_32F, 1, 0) / 16.0, cv2.Scharr(c, cv2.CV_32F, 0, 1) / 16.0))
    mags = np.stack([np.hypot(x, y) for x, y in gs])
    best = np.argmax(mags, axis=0)
    yy, xx = np.indices(best.shape)
    gx = np.stack([g[0] for g in gs])[best, yy, xx]
    gy = np.stack([g[1] for g in gs])[best, yy, xx]
    return gx, gy, mags.max(axis=0)

def hough(bgr):
    out = []
    for c in channels(bgr):
        for (rmin, rmax, dp, md, p1, p2) in ((3, 24, 1.0, 4, 120, 0.72), (20, 90, 1.5, 12, 120, 0.78), (70, MAX_R, 1.5, 30, 110, 0.80)):
            res = cv2.HoughCircles(c, cv2.HOUGH_GRADIENT_ALT, dp, md, param1=p1, param2=p2, minRadius=rmin, maxRadius=rmax)
            if res is not None:
                out.extend(res[0].tolist())
    return out

def mask_candidates(bgr, family):
    """Centres and inscribed radii of the saturated-colour lobes: finds drops whose rim is too broken to vote."""
    H, W = bgr.shape[:2]
    hsv = masks.hsv_of(bgr)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    out = []
    for ranges in masks.CLASSES[family].values():
        m = np.zeros((H, W), bool)
        for a, b, smin, vmin in ranges:
            m |= masks.hue_in(h, a, b) & (s >= smin) & (v >= vmin)
        m = ndi.binary_fill_holes(m)
        d = cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 5).astype(np.float64)
        if d.max() < MIN_R:
            continue
        log = np.log1p(d)
        peaks = log - reconstruction(np.maximum(log - 0.08, 0), log, method="dilation")
        lab, n = ndi.label((peaks > 1e-6) & (d >= MIN_R))
        if n == 0:
            continue
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            sub = d[sl] * (lab[sl] == i)
            k = np.unravel_index(np.argmax(sub), sub.shape)
            y, x = sl[0].start + k[0], sl[1].start + k[1]
            out.append([float(x), float(y), float(d[y, x]) + 0.5])
    return out

def rim_support(gx, gy, mag, x, y, r, tol=None):
    """Share of rim samples with a strong edge whose gradient points along the radius."""
    H, W = mag.shape
    a = np.linspace(0, 2 * np.pi, N_RIM, endpoint=False)
    ca, sa = np.cos(a), np.sin(a)
    tol = tol or max(1.5, 0.05 * r)
    best = np.zeros(N_RIM)
    inside = np.zeros(N_RIM, bool)
    for dr in np.arange(-tol, tol + 0.01, 1.0):
        px, py = x + (r + dr) * ca, y + (r + dr) * sa
        ix, iy = np.round(px).astype(int), np.round(py).astype(int)
        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
        inside |= ok
        m = np.zeros(N_RIM)
        m[ok] = mag[iy[ok], ix[ok]]
        rad = np.zeros(N_RIM)
        rad[ok] = np.abs(gx[iy[ok], ix[ok]] * ca[ok] + gy[iy[ok], ix[ok]] * sa[ok])
        score = np.where((m >= 4.0) & (rad >= 0.75 * m), m, 0.0)
        best = np.maximum(best, score)
    n = inside.sum()
    return float((best[inside] > 0).sum()) / max(1, n), int(n)

def refine(gx, gy, mag, x, y, r):
    """Trimmed least-squares circle through the strongest radial edge per ray: a wide pass, then a tight one."""
    x1, y1, r1, _ = fit(gx, gy, mag, x, y, r, max(2.0, 0.18 * r))
    return fit(gx, gy, mag, x1, y1, r1, max(2.0, 0.06 * r1))

def fit(gx, gy, mag, x, y, r, half):
    H, W = mag.shape
    a = np.linspace(0, 2 * np.pi, 48, endpoint=False)
    ca, sa = np.cos(a), np.sin(a)
    span = np.arange(-half, half + 0.01, 0.5)
    pts = []
    for c, s in zip(ca, sa):
        px, py = x + (r + span) * c, y + (r + span) * s
        ix, iy = np.round(px).astype(int), np.round(py).astype(int)
        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
        if ok.sum() < 3:
            continue
        val = np.zeros(len(span))
        val[ok] = np.abs(gx[iy[ok], ix[ok]] * c + gy[iy[ok], ix[ok]] * s)
        k = int(np.argmax(val))
        if val[k] >= 4.0:
            pts.append((px[k], py[k]))
    if len(pts) < 10:
        return x, y, r, 1.0
    p = np.array(pts)
    for _ in range(3):
        A = np.c_[2 * p, np.ones(len(p))]
        b = (p**2).sum(axis=1)
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
        cx, cy = sol[0], sol[1]
        rr = np.sqrt(max(sol[2] + cx**2 + cy**2, 1.0))
        res = np.abs(np.hypot(p[:, 0] - cx, p[:, 1] - cy) - rr)
        keep = res <= max(1.5, np.percentile(res, 75))
        if keep.sum() < 10:
            break
        p = p[keep]
    if abs(rr - r) > 0.3 * r + 2 or np.hypot(cx - x, cy - y) > 0.35 * r + 2:
        return x, y, r, 1.0
    err = float(np.median(np.abs(np.hypot(p[:, 0] - cx, p[:, 1] - cy) - rr)) / rr)
    return float(cx), float(cy), float(rr), err

def overlap_share(a, b):
    """Area of the two circles' intersection, as a share of the smaller circle."""
    (x0, y0, r0), (x1, y1, r1) = a, b
    d = np.hypot(x1 - x0, y1 - y0)
    small = min(r0, r1); big = max(r0, r1)
    if d >= r0 + r1:
        return 0.0
    if d <= big - small:
        return 1.0
    a0 = small**2 * np.arccos(np.clip((d**2 + small**2 - big**2) / (2 * d * small), -1, 1))
    a1 = big**2 * np.arccos(np.clip((d**2 + big**2 - small**2) / (2 * d * big), -1, 1))
    tri = 0.5 * np.sqrt(max(0.0, (-d + small + big) * (d + small - big) * (d - small + big) * (d + small + big)))
    return float((a0 + a1 - tri) / (np.pi * small**2))

def contrast(lab, x, y, r):
    """CIE76 distance between the median colour inside the disc and the ring just outside it."""
    H, W = lab.shape[:2]
    R = 1.42 * r + 1
    x0, x1 = max(0, int(x - R)), min(W, int(x + R) + 1)
    y0, y1 = max(0, int(y - R)), min(H, int(y + R) + 1)
    yy, xx = np.ogrid[y0:y1, x0:x1]
    d2 = (xx - x) ** 2 + (yy - y) ** 2
    roi = lab[y0:y1, x0:x1]
    a = roi[d2 <= (0.75 * r) ** 2]
    b = roi[(d2 >= (1.14 * r) ** 2) & (d2 <= (1.40 * r) ** 2)]
    if len(a) < 4 or len(b) < 4:
        return 0.0
    return float(np.linalg.norm(np.median(a, axis=0) - np.median(b, axis=0)))

def describe(bgr, x, y, r):
    """Median colour inside the disc (away from the rim) as hue deg, sat 0-1, val 0-1."""
    H, W = bgr.shape[:2]
    x0, x1 = max(0, int(x - r)), min(W, int(x + r) + 1)
    y0, y1 = max(0, int(y - r)), min(H, int(y + r) + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    yy, xx = np.ogrid[y0:y1, x0:x1]
    m = (xx - x) ** 2 + (yy - y) ** 2 <= (0.8 * r) ** 2
    if m.sum() < 4:
        m = (xx - x) ** 2 + (yy - y) ** 2 <= r**2
        if m.sum() == 0:
            return None
    px = bgr[y0:y1, x0:x1][m].astype(np.float32) / 255.0
    med = np.median(px, axis=0)[None, None, :]
    h, s, v = cv2.cvtColor(med, cv2.COLOR_BGR2HSV)[0, 0]
    return float(h), float(s), float(v)

def detect(bgr, family=None):
    H, W = bgr.shape[:2]
    gx, gy, mag = edge_maps(bgr)
    cands = hough(bgr)
    if family:
        cands = cands + mask_candidates(bgr, family)
    kept = []
    for x, y, r in cands:
        if r < MIN_R:
            continue
        x, y, r, err = refine(gx, gy, mag, x, y, r)
        sup, n = rim_support(gx, gy, mag, x, y, r)
        if n < 0.5 * N_RIM:  # mostly off frame: no honest estimate of its rim
            continue
        need = MIN_SUPPORT_LARGE if r >= 12 else MIN_SUPPORT_SMALL
        if sup >= need:
            kept.append((sup, x, y, r, err))
    kept.sort(key=lambda c: (c[0] * np.sqrt(c[3])), reverse=True)
    lab = cv2.cvtColor(cv2.GaussianBlur(bgr, (0, 0), 1.0).astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)
    final = []
    for sup, x, y, r, err in kept:
        c = (x, y, r)
        if any(overlap_share(c, (f["x"], f["y"], f["r"])) > SAME_CIRCLE and 0.55 < r / f["r"] < 1.8 for f in final):
            continue
        de = contrast(lab, x, y, r)
        # A weak rim needs a real colour step behind it: shading inside a drop has rim votes but no step.
        if sup < WEAK_RIM and de < MIN_STEP:
            continue
        if r < 8 and (sup < 0.8 or de < MIN_STEP):
            continue
        col = describe(bgr, x, y, r)
        if col is None:
            continue
        final.append({"x": x, "y": y, "r": r, "sup": sup, "err": err, "de": de, "h": col[0], "s": col[1], "v": col[2],
                      "edge": bool(x - r < 1 or y - r < 1 or x + r > W - 2 or y + r > H - 2)})
    final.sort(key=lambda f: -f["r"])
    out = []
    for f in final:
        keep, inside = True, None
        for g in out:
            dist = np.hypot(f["x"] - g["x"], f["y"] - g["y"])
            if dist + f["r"] <= 1.02 * g["r"] and f["r"] < 0.8 * g["r"]:
                inside = inside or g
            # Tiny circles strung along a bigger rim are dimples and compression, unless the step is plain.
            if f["r"] < 8 and abs(dist - g["r"]) < 1.5 * f["r"] + 2 and f["de"] < RIM_HUGGER_STEP:
                keep = False
                break
        if not keep:
            continue
        if inside is not None and (f["de"] < NESTED_STEP or f["sup"] < 0.7):
            continue
        f["inside"] = inside is not None
        out.append(f)
    for i, f in enumerate(out):
        f["lens"] = False
        for g in out[i + 1:]:
            if np.hypot(f["x"] - g["x"], f["y"] - g["y"]) < 0.2 * f["r"] and 0.6 <= g["r"] / f["r"] <= 0.92:
                f["lens"] = True
                g["inLens"] = True
                break
    return out

def overlay(bgr, drops):
    """White: a drop. Yellow: an inner drop. Cyan: a lens ring around a drop."""
    vis = bgr.copy()
    for d in drops:
        col = (255, 255, 0) if d.get("lens") else (0, 255, 255) if d.get("inside") else (255, 255, 255)
        cv2.circle(vis, (int(round(d["x"])), int(round(d["y"]))), int(round(d["r"])), col, 2 if d.get("lens") else 1, cv2.LINE_AA)
    return vis
