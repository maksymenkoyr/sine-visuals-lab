# What a droplet looks like as a function of distance from its centre: brightness and colour
# across the disc, the rim, the ring just outside it, the soft highlight, the direction light
# comes from and the shadow it throws. Only drops of radius >= MIN_R px, one record per track.
# Usage: profile.py <video> <det.json> <tracks.json> <out.json>
import json, sys
sys.path.insert(0, "/Users/yaro/.claude/jobs/43f57e00/tmp/oil/tools")
import cv2
import numpy as np
import circles as C

MIN_R = 30
RHO = np.arange(0, 1.6001, 0.02)
TH = np.linspace(0, 2 * np.pi, 96, endpoint=False)
SPAN = np.arange(-14, 14.01, 0.5)

video, det_path, trk_path, out_path = sys.argv[1:5]
det = json.load(open(det_path)); trk = json.load(open(trk_path))
frames = det["frames"]
tracks = [t for t in trk["tracks"] if np.mean(t["inside"]) < 0.5 and np.median(t["r"]) >= MIN_R]
print(f"{len(tracks)} tracks with r >= {MIN_R}px")

want = {}
for tid, t in enumerate(tracks):
    ok = [k for k in range(len(t["fi"])) if not t["edge"][k]]
    if not ok:
        continue
    for k in [ok[0], ok[len(ok) // 2], ok[-1]]:
        want.setdefault(t["fi"][k], []).append((tid, k))

FAMS = [("red", 345, 375), ("orange", 15, 45), ("yellow", 45, 75), ("green", 75, 170), ("blue", 170, 265), ("purple", 265, 300), ("pink/magenta", 300, 345)]
def fam(h, s):
    if s < 0.2:
        return "pale"
    for name, a, b in FAMS:
        if a <= h < b or a <= h + 360 < b:
            return name
    return "other"

def nanmed(a, axis=None):
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(a, axis=axis)

records = {}
ring_ratios = []
cap = cv2.VideoCapture(video)
for fi in sorted(want):
    cap.set(cv2.CAP_PROP_POS_FRAMES, frames[fi]["i"])
    ok, bgr = cap.read()
    if not ok:
        continue
    f = bgr.astype(np.float32) / 255.0
    Y = 0.2126 * f[..., 2] + 0.7152 * f[..., 1] + 0.0722 * f[..., 0]
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(f, cv2.COLOR_BGR2Lab)
    gx, gy, mag = C.edge_maps(bgr)
    H, W = Y.shape
    circles = [d for d in frames[fi]["drops"] if not d.get("lens")]
    for d in frames[fi]["drops"]:
        if d.get("lens"):
            inner = [g for g in circles if g.get("inLens") and np.hypot(g["x"] - d["x"], g["y"] - d["y"]) < 0.2 * d["r"]]
            if inner:
                ring_ratios.append(d["r"] / inner[0]["r"])
    for tid, k in want[fi]:
        t = tracks[tid]
        cx, cy, r = t["x"][k], t["y"][k], t["r"][k]
        others = [(o["x"], o["y"], o["r"]) for o in circles
                  if abs(o["x"] - cx) + abs(o["y"] - cy) > 0.5 and np.hypot(o["x"] - cx, o["y"] - cy) < 1.7 * r + o["r"]]
        def valid_of(mx, my):
            v = (mx >= 1) & (mx < W - 2) & (my >= 1) & (my < H - 2)
            for ox, oy, ro in others:
                v &= np.hypot(mx - ox, my - oy) > ro + 2.5
            return v
        # polar sampling
        mx = cx + RHO[:, None] * r * np.cos(TH)[None, :]
        my = cy + RHO[:, None] * r * np.sin(TH)[None, :]
        v = valid_of(mx, my)
        mxf, myf = mx.astype(np.float32), my.astype(np.float32)
        def polar(img):
            p = cv2.remap(img, mxf, myf, cv2.INTER_LINEAR).astype(np.float64)
            p[~v] = np.nan
            return p
        pY, pS, pV = polar(Y), polar(hsv[..., 1]), polar(hsv[..., 2])
        enough = v.mean(axis=1) >= 0.4
        profY = nanmed(pY, axis=1); profY[~enough] = np.nan
        profS = nanmed(pS, axis=1); profS[~enough] = np.nan
        interior = (RHO >= 0.25) & (RHO <= 0.75)
        yi, si = nanmed(profY[interior]), nanmed(profS[interior])
        if not np.isfinite(yi) or yi < 0.03:
            continue
        rec = records.setdefault(tid, {"Y": [], "S": [], "hl": [], "plane": [], "shadow": [], "rise": [], "line": [], "ring": [], "sparkle": [], "dimple": [], "yi": [], "si": [], "h": float(np.median(t["h"])), "s": float(np.median(t["s"])), "r": float(np.median(t["r"]))})
        rec["Y"].append((profY / yi).tolist()); rec["S"].append((profS - si).tolist()); rec["yi"].append(float(yi)); rec["si"].append(float(si))
        # soft highlight and tilt, on a square crop in unit-disc coordinates
        R = int(r + 2)
        x0, y0 = max(0, int(cx) - R), max(0, int(cy) - R)
        x1, y1 = min(W, int(cx) + R + 1), min(H, int(cy) + R + 1)
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        ux, uy = (xx - cx) / r, (yy - cy) / r
        rho = np.hypot(ux, uy)
        va = valid_of(xx, yy)
        sig = max(1.5, 0.05 * r)
        blur = cv2.GaussianBlur(Y[y0:y1, x0:x1], (0, 0), sig)
        m = va & (rho < 0.92)
        if m.sum() > 200:
            thr = np.percentile(blur[m], 98)
            top = m & (blur >= thr)
            rec["hl"].append((float(blur[top].mean() / yi), float(ux[top].mean()), float(uy[top].mean())))
            pl = va & (rho < 0.85)
            A = np.c_[np.ones(pl.sum()), ux[pl], uy[pl]]
            sol, *_ = np.linalg.lstsq(A, blur[pl], rcond=None)
            rec["plane"].append((float(sol[1] / sol[0]), float(sol[2] / sol[0])))
            # sparkle: bright points over the blurred disc
            th = cv2.morphologyEx(Y[y0:y1, x0:x1], cv2.MORPH_TOPHAT, np.ones((5, 5), np.uint8))
            pts = (th > 0.10) & (rho < 0.85) & va
            n, _ = cv2.connectedComponents(pts.astype(np.uint8))
            rec["sparkle"].append(float((n - 1) / (pl.sum() / 1000.0)))
            # dimple texture: band-passed interior energy
            if r >= 60:
                dog = cv2.GaussianBlur(Y[y0:y1, x0:x1], (0, 0), 1.5) - cv2.GaussianBlur(Y[y0:y1, x0:x1], (0, 0), 4.0)
                mm = va & (rho < 0.8)
                rms = float(np.sqrt(np.mean(dog[mm] ** 2)) / yi)
                z = (dog - dog[mm].mean()) * mm
                ac = np.fft.fftshift(np.fft.irfft2(np.abs(np.fft.rfft2(z, s=z.shape)) ** 2, s=z.shape))
                acy, acx = np.indices(ac.shape)
                cyc, cxc = np.array(ac.shape) // 2
                dist = np.hypot(acy - cyc, acx - cxc).astype(int)
                radial = np.bincount(dist.ravel(), ac.ravel()) / np.maximum(1, np.bincount(dist.ravel()))
                radial = radial / radial[0]
                peaks = [i for i in range(4, min(40, len(radial) - 1)) if radial[i] > radial[i - 1] and radial[i] >= radial[i + 1]]
                sp = (peaks[0], float(radial[peaks[0]])) if peaks else (None, 0.0)
                rec["dimple"].append((rms, sp[0], sp[1]))
        # shadow: first harmonic of brightness around the ring just outside the rim
        ann = (RHO >= 1.05) & (RHO <= 1.45)
        theta_prof = nanmed(pY[ann], axis=0)
        good_th = np.isfinite(theta_prof)
        if good_th.mean() >= 0.6:
            g = theta_prof[good_th]; a = TH[good_th]
            mean = np.mean(g)
            c1 = 2 * np.mean((g - mean) * np.cos(a)); s1 = 2 * np.mean((g - mean) * np.sin(a))
            rec["shadow"].append((float(np.hypot(c1, s1) / mean), float(np.arctan2(s1, c1))))
        # rim: 10-90% rise of colour distance from the interior, ray by ray in pixels; thin line at the rim
        ix = (RHO >= 0.3) & (RHO <= 0.8)
        lab_p = np.stack([cv2.remap(lab[..., c], mxf, myf, cv2.INTER_LINEAR) for c in range(3)], axis=-1).astype(np.float64)
        lab_p[~v] = np.nan
        lab_int = nanmed(lab_p[ix].reshape(-1, 3), axis=0)
        rrx = (cx + (r + SPAN)[:, None] * np.cos(TH)[None, :])
        rry = (cy + (r + SPAN)[:, None] * np.sin(TH)[None, :])
        vr = valid_of(rrx, rry)
        l2 = np.stack([cv2.remap(lab[..., c], rrx.astype(np.float32), rry.astype(np.float32), cv2.INTER_LINEAR) for c in range(3)], axis=-1).astype(np.float64)
        y2 = cv2.remap(Y, rrx.astype(np.float32), rry.astype(np.float32), cv2.INTER_LINEAR).astype(np.float64)
        D = np.linalg.norm(l2 - lab_int, axis=-1)
        rises, lines = [], []
        for j in range(len(TH)):
            if not vr[:, j].all():
                continue
            prof = D[:, j]
            lo, hi = prof[:8].mean(), prof[-8:].mean()
            if hi - lo < 12:
                continue
            n_p = (prof - lo) / (hi - lo)
            a10 = np.argmax(n_p > 0.1); a90 = np.argmax(n_p > 0.9)
            if a90 > a10:
                rises.append((a90 - a10) * 0.5)
            s0 = np.argmax(np.gradient(prof))
            # aligned brightness across the rim, for the thin line
            if 16 <= s0 < len(SPAN) - 16:
                lines.append(y2[s0 - 16: s0 + 17, j])
        if rises:
            rec["rise"].append(float(np.median(rises)))
        if len(lines) >= 16:
            lm = np.median(np.array(lines), axis=0)  # 33 samples, 0.5 px apart
            yin, yout = lm[:8].mean(), lm[-8:].mean()
            mid = lm[8:25]
            dark = (min(yin, yout) - mid.min()) / max(yi, 1e-3)
            bright = (mid.max() - max(yin, yout)) / max(yi, 1e-3)
            rec["line"].append((float(dark), float(bright)))
        # a separate circular edge outside the rim, partial or whole: the lens around the drop
        if r >= 48:
            a_ring = np.linspace(0, 2 * np.pi, 180, endpoint=False)
            ca, sa = np.cos(a_ring), np.sin(a_ring)
            best = (0.0, None)
            for q in np.arange(1.14, 1.61, 0.02):
                if (q - 1) * r < 12:  # the drop's own soft rim still holds edge energy this close in
                    continue
                hits = np.zeros(len(a_ring), bool); vals = np.zeros(len(a_ring), bool)
                for dr in np.arange(-2.0, 2.01, 1.0):
                    px, py = cx + (q * r + dr) * ca, cy + (q * r + dr) * sa
                    ix, iy = np.round(px).astype(int), np.round(py).astype(int)
                    ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
                    for ox, oy, ro in others:
                        ok &= np.hypot(px - ox, py - oy) > ro + 4
                    vals |= ok
                    m = np.zeros(len(a_ring)); rad = np.zeros(len(a_ring))
                    m[ok] = mag[iy[ok], ix[ok]]
                    rad[ok] = np.abs(gx[iy[ok], ix[ok]] * ca[ok] + gy[iy[ok], ix[ok]] * sa[ok])
                    hits |= (m >= 5.0) & (rad >= 0.75 * m)
                if vals.mean() >= 0.6:
                    sup = float((hits & vals).sum() / vals.sum())
                    if sup > best[0]:
                        best = (sup, float(q))
            rec["ring"].append(best)
cap.release()

def med(xs):
    return float(np.median(xs)) if len(xs) else None

def circ_mean(angles, weights):
    z = np.sum(np.array(weights) * np.exp(1j * np.array(angles)))
    return float(np.angle(z)), float(np.abs(z) / np.sum(weights))

groups = {}
for tid, rec in records.items():
    groups.setdefault(fam(rec["h"], rec["s"]), []).append(rec)

def sample_at(arr, a, b):
    m = (RHO >= a) & (RHO <= b)
    with np.errstate(all="ignore"):
        return nanmed(arr[m])

out = {"rho": RHO.round(2).tolist(), "n_tracks": len(records), "groups": {}, "ring_ratio_full_lens": [round(float(np.median(ring_ratios)), 2), len(ring_ratios)] if ring_ratios else None}
for name, recs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
    Ys = np.array([nanmed(np.array(r["Y"]), axis=0) for r in recs])
    Ss = np.array([nanmed(np.array(r["S"]), axis=0) for r in recs])
    p50 = nanmed(Ys, axis=0)
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore", RuntimeWarning)
        p25 = np.nanpercentile(Ys, 25, axis=0); p75 = np.nanpercentile(Ys, 75, axis=0)
    # per-track rim numbers
    rimmin, rimpos, rimmax, maxpos, falloff, outside = [], [], [], [], [], []
    for yp in Ys:
        a = (RHO >= 0.92) & (RHO <= 1.04); b = (RHO >= 0.98) & (RHO <= 1.14)
        if np.isfinite(yp[a]).sum() < 3 or np.isfinite(yp[b]).sum() < 3:
            continue
        rimmin.append(np.nanmin(yp[a])); rimpos.append(RHO[a][np.nanargmin(yp[a])])
        rimmax.append(np.nanmax(yp[b])); maxpos.append(RHO[b][np.nanargmax(yp[b])])
        falloff.append(sample_at(yp, 0.85, 0.92)); outside.append(sample_at(yp, 1.3, 1.6))
    hl = [np.median(np.array(r["hl"]), axis=0) for r in recs if r["hl"]]
    pl = [np.median(np.array(r["plane"]), axis=0) for r in recs if r["plane"]]
    sh = [(np.median([s[0] for s in r["shadow"]]), float(np.angle(np.mean(np.exp(1j * np.array([s[1] for s in r["shadow"]])))))) for r in recs if r["shadow"]]
    hl_ratio = [h[0] for h in hl]
    tilt = [float(np.hypot(p[0], p[1])) for p in pl]
    tilt_ang = [float(np.arctan2(p[1], p[0])) for p in pl]
    rises = [med(r["rise"]) for r in recs if r["rise"]]
    lines = [np.median(np.array(r["line"]), axis=0) for r in recs if r["line"]]
    rings = [max(r["ring"], key=lambda q: q[0]) for r in recs if r["ring"]]
    has_ring = [q for q in rings if q[0] >= 0.35 and q[1]]
    dim = [np.array([x[0] for x in r["dimple"]]) for r in recs if r["dimple"]]
    ringy = [q for q in rings if q[0] >= 0.5 and q[1]]
    entry = {
        "tracks": len(recs), "radius_px_p50": round(med([r["r"] for r in recs]), 1),
        "Y_interior_p50": round(med([med(r["yi"]) for r in recs]), 3), "S_interior_p50": round(med([med(r["si"]) for r in recs]), 3),
        "profile_Y_over_interior": {"p25": [None if not np.isfinite(x) else round(float(x), 3) for x in p25], "p50": [None if not np.isfinite(x) else round(float(x), 3) for x in p50], "p75": [None if not np.isfinite(x) else round(float(x), 3) for x in p75]},
        "S_profile_delta_p50": [None if not np.isfinite(x) else round(float(x), 3) for x in nanmed(Ss, axis=0)],
        "Y_at_rho0_0.1": round(float(sample_at(p50, 0.0, 0.1)), 3), "Y_at_rho0.85_0.92_falloff": round(float(np.median(falloff)), 3) if falloff else None,
        "rim_min_Y_over_interior": round(float(np.median(rimmin)), 3) if rimmin else None, "rim_min_at_rho": round(float(np.median(rimpos)), 3) if rimpos else None,
        "rim_max_Y_over_interior": round(float(np.median(rimmax)), 3) if rimmax else None, "rim_max_at_rho": round(float(np.median(maxpos)), 3) if maxpos else None,
        "paint_outside_Y_over_interior": round(float(np.median(outside)), 3) if outside else None,
        "highlight_peak_over_interior_p50_p90": [round(float(np.percentile(hl_ratio, q)), 3) for q in (50, 90)] if hl_ratio else None,
        "highlight_share_with_peak_over_1.15": round(float(np.mean(np.array(hl_ratio) > 1.15)), 2) if hl_ratio else None,
        "highlight_offset_unit_disc_p50": [round(float(np.median([h[1] for h in hl if h[0] > 1.15] or [0])), 3), round(float(np.median([h[2] for h in hl if h[0] > 1.15] or [0])), 3)],
        "tilt_rel_per_radius_p50": round(float(np.median(tilt)), 3) if tilt else None,
        "tilt_bright_dir_deg_and_consistency": (lambda a, c: [round(float(np.degrees(a)), 0), round(float(c), 2)])(*circ_mean(tilt_ang, [max(1e-4, x) for x in tilt])) if tilt else None,
        "shadow_ring_contrast_p50": round(float(np.median([s[0] for s in sh])), 3) if sh else None,
        "shadow_bright_dir_deg_and_consistency": (lambda a, c: [round(float(np.degrees(a)), 0), round(float(c), 2)])(*circ_mean([s[1] for s in sh], [s[0] for s in sh])) if sh else None,
        "rim_rise_10_90_px_p25_p50_p75": [round(float(np.percentile(rises, q)), 1) for q in (25, 50, 75)] if rises else None,
        "rim_line_dark_bright_over_interior_p50": [round(float(np.median([l[0] for l in lines])), 3), round(float(np.median([l[1] for l in lines])), 3)] if lines else None,
        "sparkle_points_per_1000px2_p50": round(float(np.median([med(r["sparkle"]) for r in recs if r["sparkle"]])), 3) if any(r["sparkle"] for r in recs) else None,
        "lens_ring_support35_share_r48plus": [round(len(has_ring) / max(1, len(rings)), 2), len(rings)] if rings else None,
        "lens_ring_support50_share_r48plus": round(len(ringy) / max(1, len(rings)), 2) if rings else None,
        "lens_ring_radius_over_r_p50": round(float(np.median([q[1] for q in ringy or has_ring])), 2) if has_ring else None,
        "dimple_rms_sorted_top5": [round(float(x.mean()), 3) for x in sorted(dim, key=lambda x: -x.mean())[:5]] if dim else None,
        "dimple_rms_median": round(float(np.median([x.mean() for x in dim])), 3) if dim else None,
    }
    out["groups"][name] = entry
out["tracks_detail"] = [{"fam": fam(r["h"], r["s"]), "r": round(r["r"], 1), "Y": [None if not np.isfinite(x) else round(float(x), 3) for x in nanmed(np.array(r["Y"]), axis=0)],
                         "yi": round(med(r["yi"]), 3), "tilt": round(float(np.median([np.hypot(a, b) for a, b in r["plane"]])), 3) if r["plane"] else None, "peak": round(float(np.median([h[0] for h in r["hl"]])), 3) if r["hl"] else None, "falloff": round(float(np.nanmedian(np.array(r["Y"])[:, (RHO >= 0.85) & (RHO <= 0.92)])), 3), "dimple": [round(float(np.mean([x[0] for x in r["dimple"]])), 3), [x[1] for x in r["dimple"]]] if r["dimple"] else None,
                         "ring": max(r["ring"], key=lambda q: q[0]) if r["ring"] else None} for r in records.values()]
json.dump(out, open(out_path, "w"), indent=1)
for k, v in out["groups"].items():
    print(k, json.dumps({kk: vv for kk, vv in v.items() if not kk.startswith("profile") and kk != "S_profile_delta_p50"}))
print("full lens ring ratio", out["ring_ratio_full_lens"])
