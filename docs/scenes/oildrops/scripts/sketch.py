# A still of a droplet layer drawn only from the measured numbers, over our own simulated paint,
# to show what those numbers give before anyone builds a simulation. Writes page/sketch_{A,B}.jpg.
import json
import cv2, numpy as np
ROOT = "/Users/yaro/.claude/jobs/43f57e00/tmp/"; OUT = ROOT + "oil/out/"; PG = ROOT + "oil/page/"
W, H = 1280, 720; S = W / 1920
LIGHT = np.array([np.cos(np.radians(-115)), np.sin(np.radians(-115))])
RHO = np.arange(0, 1.6001, 0.02)
EDGE_SOFT = 10 * S   # measured rim rise (see the study page) as a linear ramp width at this size

def hexbgr(h):
    return np.array([int(h[5:7], 16), int(h[3:5], 16), int(h[1:3], 16)], np.float32) / 255

def profile(windows, fam, fallback=None):
    Ys = []
    for w in windows:
        for t in json.load(open(OUT + f"pr_{w}.json"))["tracks_detail"]:
            if t["fam"] == fam:
                Ys.append([np.nan if v is None else v for v in t["Y"]])
    if not Ys:
        return fallback
    p = np.nanmedian(np.array(Ys, float), axis=0)
    return np.where(np.isfinite(p), p, 1.0)[: 52]  # up to the rim, rho 1.02

def relax(rs, rng, overlap, it=400):
    n = len(rs)
    xy = np.c_[rng.uniform(-40, W + 40, n), rng.uniform(-40, H + 40, n)]
    for _ in range(it):
        d = xy[:, None] - xy[None, :]
        dist = np.hypot(d[..., 0], d[..., 1]) + 1e-6
        need = rs[:, None] + rs[None, :] - overlap * np.minimum(rs[:, None], rs[None, :])
        push = np.maximum(0, need - dist) * 0.5
        np.fill_diagonal(push, 0)
        move = (d / dist[..., None] * push[..., None]).sum(axis=1)
        xy += np.clip(move, -12, 12) * 0.55
        xy[:, 0] = np.clip(xy[:, 0], -rs * 0.5, W + rs * 0.5)
        xy[:, 1] = np.clip(xy[:, 1], -rs * 0.5, H + rs * 0.5)
    return xy

def roi(cx, cy, R):
    return max(0, int(cx - R)), max(0, int(cy - R)), min(W, int(cx + R) + 1), min(H, int(cy + R) + 1)

def shadow(img, cx, cy, r, amount):
    x0, y0, x1, y1 = roi(cx, cy, 1.75 * r + 8)
    if x1 <= x0 or y1 <= y0: return
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    rs = np.hypot(xx - (cx - LIGHT[0] * 0.13 * r), yy - (cy - LIGHT[1] * 0.13 * r)) / r
    k = 1 - amount * np.clip((1.42 - rs) / 0.5, 0, 1)
    img[y0:y1, x0:x1] *= k[..., None]

def drop(img, paint, cx, cy, r, col, prof, tilt, peak, sparkles, rng, lens=False, lens_k=1.25):
    x0, y0, x1, y1 = roi(cx, cy, 1.5 * r + 8)
    if x1 <= x0 or y1 <= y0: return
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    ux, uy = (xx - cx) / r, (yy - cy) / r
    rho = np.hypot(ux, uy)
    if lens:
        ring = (rho >= 1.0) & (rho < lens_k)
        k = 0.62 + 0.38 * np.clip((rho - 1.0) / (lens_k - 1.0), 0, 1)
        mx = (cx + (xx - cx) * k).astype(np.float32); my = (cy + (yy - cy) * k).astype(np.float32)
        ref = cv2.remap(paint, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        img[y0:y1, x0:x1][ring] = ref[ring]
        side = np.clip(-(ux * LIGHT[0] + uy * LIGHT[1]) / np.maximum(rho, 1e-3), 0, 1)  # lit side is away from the shadow
        thin = np.exp(-(((rho - lens_k) * r / 1.6) ** 2)) * np.clip((ux * LIGHT[0] + uy * LIGHT[1]) / np.maximum(rho, 1e-3), 0, 1)
        img[y0:y1, x0:x1] += (thin * 0.75)[..., None]
        crescent = ring * side * np.clip(1 - (rho - 1.02) / 0.1, 0, 1)
        img[y0:y1, x0:x1] *= (1 - 0.7 * crescent)[..., None]
    prof_y = np.interp(rho, RHO[: len(prof)], prof, right=prof[-1])
    shade = prof_y * (1 + tilt * (ux * LIGHT[0] + uy * LIGHT[1]))
    g = np.exp(-(((ux + 0.12) ** 2 + (uy + 0.33) ** 2) / (2 * 0.28**2)))
    body = col[None, None, :] * (shade + (peak - 1) * g)[..., None]
    body = body + (0.22 * (peak - 1) * g)[..., None]  # a highlight leans toward white, it does not just brighten the hue
    if sparkles > 0:
        n = rng.poisson(sparkles * np.pi * (r / S) ** 2 / 1000)
        pts = np.zeros(body.shape[:2], np.float32)
        for _ in range(n):
            a = rng.uniform(0, 2 * np.pi); q = np.sqrt(rng.uniform(0, 0.8))
            px, py = cx + r * (q * np.cos(a) - 0.05), cy + r * (q * np.sin(a) - 0.1)
            ix, iy = int(px) - x0, int(py) - y0
            if 0 <= iy < pts.shape[0] and 0 <= ix < pts.shape[1]:
                pts[iy, ix] = rng.uniform(0.25, 0.9)
        pts = cv2.GaussianBlur(pts, (0, 0), 0.7) * 1.1
        body = body + pts[..., None]
    a = np.clip((1 - rho) * r / EDGE_SOFT + 0.5, 0, 1)[..., None]
    img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - a) + body * a

def sizes(counts, top, rng):
    edges = [3, 6, 12, 24, 48, 96, top]
    out = []
    for n, a, b in zip(counts, edges[:-1], edges[1:]):
        out.extend(np.exp(rng.uniform(np.log(a), np.log(b), n)).tolist())
    return np.array(sorted(out, reverse=True)) * S

def frame_radii(window, t):
    fr = min(json.load(open(OUT + f"det_{window}.json"))["frames"], key=lambda f: abs(f["t"] - t))
    return np.array(sorted((d["r"] for d in fr["drops"] if not d.get("lens") and not d.get("inside")), reverse=True)) * S

def render(name, seed, radii, overlap, paint_fn, fams, lens_share, inner_share, shadow_amt):
    rng = np.random.default_rng(seed)
    paint = paint_fn()
    img = paint.copy()
    rs = radii
    xy = relax(rs, rng, overlap)
    def pick(r):
        names = list(fams); p = np.array([fams[k]["p"] if r / S >= 12 else fams[k].get("p_small", fams[k]["p"]) for k in names]); p = p / p.sum()
        return names[rng.choice(len(names), p=p)]
    who = [pick(r) for r in rs]
    for (x, y), r in zip(xy, rs):
        if r / S >= 12:
            shadow(img, x, y, r, shadow_amt)
    for (x, y), r, k in zip(xy, rs, who):
        f = fams[k]
        lens = r / S >= 48 and rng.random() < lens_share
        drop(img, paint, x, y, r, f["col"], f["prof"], f["tilt"], f["peak"], f["sparkle"], rng, lens=lens, lens_k=rng.uniform(1.18, 1.3))
        if r / S >= 24 and rng.random() < inner_share:
            q = rng.uniform(0.06, 0.2); a = rng.uniform(0, 2 * np.pi); d = rng.uniform(0.15, 0.7)
            other = [o for o in fams if o != k]
            g = fams[other[rng.integers(len(other))]]
            drop(img, paint, x + r * d * np.cos(a), y + r * d * np.sin(a), r * q, g["col"], g["prof"], g["tilt"], g["peak"], 0, rng)
    cv2.imwrite(PG + f"sketch_{name}.jpg", (np.clip(img, 0, 1) * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 82])
    yy, xx = np.ogrid[:H // 2, :W // 2]; m = np.zeros((H // 2, W // 2), bool)
    for (x, y), r in zip(xy, rs):
        m |= (xx - x / 2) ** 2 + (yy - y / 2) ** 2 <= (r / 2) ** 2
    print(name, "drops", len(rs), "covered", round(float(m.mean()), 3))

def sim_frame():
    f = cv2.imread(ROOT + "shots/seqB/f_0120.jpg")
    return cv2.resize(f, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255

def paint_A():
    return sim_frame()

def paint_B():
    f = sim_frame(); rng = np.random.default_rng(3)
    lum = cv2.cvtColor((f * 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    base = hexbgr("#0c071a")[None, None, :] * (1 - lum[..., None]) + hexbgr("#1a3c9e")[None, None, :] * lum[..., None]
    dots = (rng.random((H, W)) > 0.9985).astype(np.float32)
    return base + cv2.GaussianBlur(dots, (0, 0), 0.8)[..., None] * np.array([0.9, 0.8, 0.5], np.float32) * 3

A = ("A1", "A2")
red = profile(A, "red"); pink = profile(A, "pink/magenta", red)
FA = {"red": {"col": hexbgr("#c80003"), "prof": red, "tilt": 0.147, "peak": 1.03, "sparkle": 0.0, "p": 0.55, "p_small": 0.55},  # big reds: flat, no broad highlight
      "pink": {"col": hexbgr("#962f7a"), "prof": pink, "tilt": 0.37, "peak": 1.3, "sparkle": 0.0, "p": 0.30, "p_small": 0.2},
      "orange": {"col": hexbgr("#cc5d05"), "prof": red, "tilt": 0.17, "peak": 1.15, "sparkle": 0.0, "p": 0.1, "p_small": 0.2},
      "blue": {"col": hexbgr("#06469b"), "prof": red, "tilt": 0.46, "peak": 1.3, "sparkle": 0.0, "p": 0.05, "p_small": 0.05}}
B = ("B",)
pb = profile(B, "pink/magenta"); ob = profile(B, "orange", pb); yb = profile(B, "yellow", pb)
FB = {"pink": {"col": hexbgr("#a84580"), "prof": pb, "tilt": 0.35, "peak": 1.45, "sparkle": 2.9, "p": 0.49},
      "orange": {"col": hexbgr("#d9650a"), "prof": ob, "tilt": 0.27, "peak": 1.13, "sparkle": 0.0, "p": 0.31},
      "yellow": {"col": hexbgr("#d2ac0a"), "prof": yb, "tilt": 0.10, "peak": 1.06, "sparkle": 0.0, "p": 0.13},
      "red": {"col": hexbgr("#9d3b3d"), "prof": pb, "tilt": 0.29, "peak": 1.2, "sparkle": 0.8, "p": 0.04},
      "purple": {"col": hexbgr("#6e3c7a"), "prof": pb, "tilt": 0.25, "peak": 1.5, "sparkle": 3.8, "p": 0.03}}
render("A", 11, frame_radii("A1", 5.0), 0.10, paint_A, FA, 0.3, 0.2, 0.42)
render("B", 12, frame_radii("B", 115.0), 0.14, paint_B, FB, 0.0, 0.22, 0.5)
