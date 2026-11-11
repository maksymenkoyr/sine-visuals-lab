# Links the per-frame circles into droplet tracks and reports counts, sizes, motion, contacts,
# nesting, colours and merges for one window. Distances are stated as % of frame width.
# Usage: analyze.py <det.json> <out.json> <tracks.json>
import json, sys
import numpy as np
from scipy.optimize import linear_sum_assignment

W, H = 1920, 1080
BINS = [(3, 6), (6, 12), (12, 24), (24, 48), (48, 96), (96, 1e9)]
BIN_NAMES = ["3-6", "6-12", "12-24", "24-48", "48-96", "96+"]
MAX_MISS = 3     # a drop may vanish for this many samples (0.6 s at 5 fps) and keep its track
MIN_TRACK = 6    # samples, under which a track is too short to count as a drop

def pct(v):
    return float(100.0 * np.asarray(v) / W)

det = json.load(open(sys.argv[1]))
frames = det["frames"]
dt = det["step"] / det["fps"]
print(f"{sys.argv[1]}: {len(frames)} samples, dt={dt:.3f}s, t {frames[0]['t']}..{frames[-1]['t']}")

def link(shift):
    """shift[fi] is the shared displacement expected between samples fi-1 and fi."""
    tracks, active = [], []
    for fi, fr in enumerate(frames):
        dets = [d for d in fr["drops"] if not d.get("lens")]
        act = [t for t in active if fi - t["fi"][-1] <= MAX_MISS + 1]
        if act and dets:
            c = np.full((len(act), len(dets)), 1e6)
            for a, tr in enumerate(act):
                x0, y0, r0 = tr["x"][-1], tr["y"][-1], tr["r"][-1]
                for g in range(tr["fi"][-1] + 1, fi + 1):
                    x0 += shift[g][0]; y0 += shift[g][1]
                for b, d in enumerate(dets):
                    dist = np.hypot(d["x"] - x0, d["y"] - y0)
                    dr = abs(d["r"] - r0)
                    if dist <= max(10.0, 0.4 * r0) and dr <= max(2.5, 0.2 * r0):
                        c[a, b] = dist + 0.5 * dr
            ia, ib = linear_sum_assignment(c)
            used = set()
            for a, b in zip(ia, ib):
                if c[a, b] < 1e5:
                    d = dets[b]; used.add(b); tr = act[a]
                    for k, v in (("fi", fi), ("x", d["x"]), ("y", d["y"]), ("r", d["r"]), ("inside", bool(d.get("inside"))),
                                 ("edge", bool(d["edge"])), ("h", d["h"]), ("s", d["s"]), ("v", d["v"]), ("sup", d["sup"]), ("err", d["err"])):
                        tr[k].append(v)
            new = [dets[b] for b in range(len(dets)) if b not in used]
        else:
            new = dets
        for d in new:
            tr = {"fi": [fi], "x": [d["x"]], "y": [d["y"]], "r": [d["r"]], "inside": [bool(d.get("inside"))], "edge": [bool(d["edge"])],
                  "h": [d["h"]], "s": [d["s"]], "v": [d["v"]], "sup": [d["sup"]], "err": [d["err"]]}
            tracks.append(tr)
            act.append(tr)
        active = act
    return tracks

def shared_shift(tracks):
    """Median per-sample displacement of the larger tracks: a slow pan would otherwise outrun the gate."""
    per = [[] for _ in frames]
    for t in tracks:
        if np.median(t["r"]) < 12:
            continue
        fi = t["fi"]
        for a in range(1, len(fi)):
            if fi[a] == fi[a - 1] + 1:
                per[fi[a]].append((t["x"][a] - t["x"][a - 1], t["y"][a] - t["y"][a - 1]))
    return [(float(np.median([p[0] for p in q])), float(np.median([p[1] for p in q]))) if len(q) >= 3 else (0.0, 0.0) for q in per]

shift = [(0.0, 0.0)] * len(frames)
for _ in range(3):
    tracks = link(shift)
    shift = shared_shift(tracks)
tracks = link(shift)
good = [t for t in tracks if len(t["fi"]) >= MIN_TRACK]
print(f"tracks: {len(tracks)} raw, {len(good)} with >= {MIN_TRACK} samples")

# ---- per-frame counts and coverage
bin_counts = []
cov = []
for fr in frames:
    ds = [d for d in fr["drops"] if not d.get("lens")]
    r = np.array([d["r"] for d in ds]) if ds else np.zeros(0)
    bin_counts.append([int(((r >= a) & (r < b)).sum()) for a, b in BINS])
    img = np.zeros((H // 4, W // 4), bool)
    yy, xx = np.ogrid[:H // 4, :W // 4]
    for d in ds:
        img |= (xx - d["x"] / 4) ** 2 + (yy - d["y"] / 4) ** 2 <= (d["r"] / 4) ** 2
    cov.append(float(img.mean()))
bin_counts = np.array(bin_counts)
lens_per_frame = [sum(1 for d in fr["drops"] if d.get("lens")) for fr in frames]
inner_per_frame = [sum(1 for d in fr["drops"] if d.get("inside")) for fr in frames]

# ---- sizes: one radius per track, drops not nested inside a bigger one
def meds(t):
    return {k: float(np.median(t[k])) for k in ("x", "y", "r", "h", "s", "v", "sup", "err")}
outer = [t for t in good if np.mean(t["inside"]) < 0.5]
inner = [t for t in good if np.mean(t["inside"]) >= 0.5]
rs = np.array([meds(t)["r"] for t in outer])
ri = np.array([meds(t)["r"] for t in inner]) if inner else np.zeros(0)
hist = [int(((rs >= a) & (rs < b)).sum()) for a, b in BINS]
# count density per factor of two in radius, fitted where detection is reliable (r >= 12 px)
fit_slope = None
xs, ys = [], []
for (a, b), n in zip(BINS[2:5], hist[2:5]):
    if n > 0:
        xs.append(np.log2(np.sqrt(a * b))); ys.append(np.log2(n))
if len(xs) >= 2:
    fit_slope = float(np.polyfit(xs, ys, 1)[0])

# ---- motion: 1 s displacement along each track
K = int(round(1.0 / dt))
rows = []
for tid, t in enumerate(good):
    fi = np.array(t["fi"]); x = np.array(t["x"]); y = np.array(t["y"]); r = np.array(t["r"])
    for i in range(len(fi) - K):
        j = np.searchsorted(fi, fi[i] + K)
        if j < len(fi) and fi[j] == fi[i] + K:
            T = K * dt
            rows.append((tid, fi[i], (x[i] + x[j]) / 2, (y[i] + y[j]) / 2, np.median(r), (x[j] - x[i]) / T, (y[j] - y[i]) / T, np.mean(t["inside"]) >= 0.5))
rows = np.array(rows) if rows else np.zeros((0, 8))
pan = {}
for fi in np.unique(rows[:, 1]):
    m = rows[:, 1] == fi
    pan[int(fi)] = (float(np.median(rows[m, 5])), float(np.median(rows[m, 6])))
vx, vy = rows[:, 5], rows[:, 6]
speed = np.hypot(vx, vy)
px = np.array([pan[int(f)][0] for f in rows[:, 1]]); py = np.array([pan[int(f)][1] for f in rows[:, 1]])
res = np.hypot(vx - px, vy - py)
speed_by_bin = []
for a, b in BINS:
    m = (rows[:, 4] >= a) & (rows[:, 4] < b) & (rows[:, 7] < 0.5)
    speed_by_bin.append({"n_samples": int(m.sum()), "n_tracks": len(set(rows[m, 0].astype(int).tolist())),
                         "speed_pct_p50": round(pct(np.median(speed[m])), 3) if m.any() else None,
                         "resid_pct_p50": round(pct(np.median(res[m])), 3) if m.any() else None})
# drop speed against size, on tracks of 12 px and up
m = rows[:, 4] >= 12
slope = float(np.polyfit(np.log(rows[m, 4]), np.log(np.maximum(res[m], 1e-3)), 1)[0]) if m.sum() > 20 else None

# ---- do drops move together? velocity correlation against separation, one sample per second
seps = [(0, 5), (5, 10), (10, 20), (20, 40), (40, 80)]
sums = {s: [0.0, 0.0, 0] for s in seps}  # raw vv, pan-removed vv, n
var_raw, var_res, nv = 0.0, 0.0, 0
for fi in np.unique(rows[:, 1])[:: K]:
    m = rows[:, 1] == fi
    if m.sum() < 3:
        continue
    x, y, u, v = rows[m, 2], rows[m, 3], rows[m, 5], rows[m, 6]
    u2, v2 = u - pan[int(fi)][0], v - pan[int(fi)][1]
    var_raw += float((u**2 + v**2).sum()); var_res += float((u2**2 + v2**2).sum()); nv += len(u)
    for i in range(len(x)):
        for j in range(i + 1, len(x)):
            d = 100.0 * np.hypot(x[i] - x[j], y[i] - y[j]) / W
            for s in seps:
                if s[0] <= d < s[1]:
                    sums[s][0] += u[i] * u[j] + v[i] * v[j]
                    sums[s][1] += u2[i] * u2[j] + v2[i] * v2[j]
                    sums[s][2] += 1
corr = {f"{a}-{b}%W": {"raw": round(v[0] / v[2] / (var_raw / nv), 3), "pan_removed": round(v[1] / v[2] / (var_res / nv), 3), "pairs": v[2]}
        for (a, b), v in sums.items() if v[2] > 0}

# ---- straightness and radius stability
straight, rstab = [], []
for t in good:
    fi = np.array(t["fi"]); x = np.array(t["x"]); y = np.array(t["y"]); r = np.array(t["r"])
    if np.median(r) >= 12:
        rstab.append(float(np.std(r) / np.median(r)))
    if len(fi) >= 3 * K and np.median(r) >= 12:
        path = np.hypot(np.diff(x[:: K]), np.diff(y[:: K])).sum()
        if path > 0:
            straight.append(float(np.hypot(x[-1] - x[0], y[-1] - y[0]) / path))

# ---- contacts and nesting, per frame
contacts = []; depth = []; have_inner = []; inner_ratio = []
for fr in frames[:: K]:
    ds = [d for d in fr["drops"] if not d.get("lens")]
    if len(ds) < 2:
        continue
    X = np.array([d["x"] for d in ds]); Y = np.array([d["y"] for d in ds]); R = np.array([d["r"] for d in ds])
    d = np.hypot(X[:, None] - X[None, :], Y[:, None] - Y[None, :])
    big = R >= 12
    nest = (d + R[:, None] <= 1.02 * R[None, :]) & (R[:, None] < 0.8 * R[None, :])  # i inside j
    for j in np.nonzero(R >= 24)[0]:
        have_inner.append(bool(nest[:, j].any()))
        inner_ratio.extend((R[nest[:, j]] / R[j]).tolist())
    gap = d - R[:, None] - R[None, :]
    touch = (gap < 3) & ~nest & ~nest.T
    np.fill_diagonal(touch, False)
    tb = touch & big[:, None] & big[None, :]
    contacts.extend(tb[big].sum(axis=1).tolist())
    i, j = np.nonzero(np.triu(tb))
    depth.extend((np.maximum(0, -gap[i, j]) / np.minimum(R[i], R[j])).tolist())

# ---- colours, by hue family and by track
FAMS = [("red", 345, 375), ("orange", 15, 45), ("yellow", 45, 75), ("green", 75, 170), ("blue", 170, 265), ("purple", 265, 300), ("pink/magenta", 300, 345)]
def fam(h, s):
    if s < 0.2:
        return "pale"
    for name, a, b in FAMS:
        if a <= h < b or a <= h + 360 < b:
            return name
    return "other"
cols = {}
for t in outer:
    m = meds(t)
    if m["r"] < 12:
        continue
    k = fam(m["h"], m["s"])
    cols.setdefault(k, []).append((m["r"] ** 2, m["h"], m["s"], m["v"]))
tot = sum(a for v in cols.values() for a, *_ in v)
palette = {k: {"tracks": len(v), "area_share": round(sum(a for a, *_ in v) / tot, 3), "h_s_v_median": [round(float(np.median([x[i] for x in v])), 2) for i in (1, 2, 3)]}
           for k, v in sorted(cols.items(), key=lambda kv: -sum(a for a, *_ in kv[1]))}

# ---- merges: a drop that vanishes away from the frame edge, beside a bigger drop that then grows
ended = ended12 = merges = 0; examples = []; vanished = []
last_fi = len(frames) - 1
for t in good:
    e = t["fi"][-1]
    x, y, r = t["x"][-1], t["y"][-1], float(np.median(t["r"][-5:]))
    if e > last_fi - 5 or r < 6 or x - r < 20 or y - r < 20 or x + r > W - 20 or y + r > H - 20:
        continue
    # really gone: nothing of that size at that place in the next 1.5 s
    again = False
    px_, py_ = x, y
    for g, fr in enumerate(frames[e + 1: e + 1 + int(1.5 / dt)], e + 1):
        px_ += shift[g][0]; py_ += shift[g][1]
        for d in fr["drops"]:
            if np.hypot(d["x"] - px_, d["y"] - py_) < max(8.0, r) and 0.6 < d["r"] / r < 1.6:
                again = True
    if again:
        continue
    ended += 1
    if r >= 12:
        ended12 += 1
        vanished.append({"t": frames[e]["t"], "x": round(x), "y": round(y), "r": round(r, 1), "dx": round(sum(shift[g][0] for g in range(e + 1, min(len(frames), e + 6))), 1), "dy": round(sum(shift[g][1] for g in range(e + 1, min(len(frames), e + 6))), 1)})
    for o in good:
        if o is t or e not in o["fi"]:
            continue
        i = o["fi"].index(e)
        R = o["r"][i]
        # below this size ratio the bigger drop's growth is lost in its own radius noise
        if R < r or r / R < 0.2 or np.hypot(o["x"][i] - x, o["y"][i] - y) - r - R > max(3.0, 0.3 * r):
            continue
        fo = np.array(o["fi"]); ro = np.array(o["r"])
        before = ro[(fo >= e - 5) & (fo <= e)]
        after = ro[(fo >= e + 2) & (fo <= e + 7)]
        if len(before) >= 3 and len(after) >= 3 and (np.median(after) ** 2 - np.median(before) ** 2) / r**2 >= 0.5:
            merges += 1
            examples.append({"t": frames[e]["t"], "x": round(x), "y": round(y), "r": round(r, 1), "into_r": round(float(R), 1)})
            break
duration = (len(frames) - 1) * dt

out = {
    "window": [frames[0]["t"], frames[-1]["t"]], "duration_s": round(duration, 2),
    "counts_median_per_frame": dict(zip(BIN_NAMES, [int(x) for x in np.median(bin_counts, axis=0)])),
    "count_all_median": int(np.median(bin_counts.sum(axis=1))), "count_r12plus_median": int(np.median(bin_counts[:, 2:].sum(axis=1))),
    "coverage_share_median": round(float(np.median(cov)), 3),
    "lens_rings_median_per_frame": float(np.median(lens_per_frame)), "inner_drops_median_per_frame": float(np.median(inner_per_frame)),
    "tracks_outer": len(outer), "tracks_inner": len(inner),
    "radius_pct_of_width": {"p10": round(pct(np.percentile(rs, 10)), 2), "p50": round(pct(np.percentile(rs, 50)), 2), "p90": round(pct(np.percentile(rs, 90)), 2), "max": round(pct(rs.max()), 2)},
    "radius_px1920_tracks_by_bin": dict(zip(BIN_NAMES, hist)), "size_slope_log2N_per_log2r_r12to96": fit_slope,
    "inner_radius_px1920_p50": round(float(np.median(ri)), 1) if len(ri) else None,
    "speed_pct_per_s": {"all_p50": round(pct(np.median(speed)), 3), "all_p90": round(pct(np.percentile(speed, 90)), 3), "after_removing_pan_p50": round(pct(np.median(res)), 3), "after_removing_pan_p90": round(pct(np.percentile(res, 90)), 3),
                        "pan_vector_median_vx_vy": [round(pct(np.median(px)), 3), round(pct(np.median(py)), 3)]},
    "speed_by_radius_bin": dict(zip(BIN_NAMES, speed_by_bin)), "resid_speed_vs_radius_loglog_slope_r12plus": slope,
    "velocity_correlation_by_separation": corr,
    "straightness_net_over_path_tracks3s_p50": round(float(np.median(straight)), 2) if straight else None,
    "radius_cv_p50": round(float(np.median(rstab)), 3), "rim_fit_error_share_of_r_p50": round(float(np.median([meds(t)["err"] for t in outer if meds(t)["r"] >= 12])), 4),
    "contacts_per_drop_r12plus": {"mean": round(float(np.mean(contacts)), 2), "share_touching_any": round(float(np.mean(np.array(contacts) > 0)), 2)},
    "contact_overlap_depth_share_of_smaller_r_p50_p90": [round(float(np.percentile(depth, q)), 3) for q in (50, 90)] if depth else None,
    "drops_r24plus_with_inner_share": round(float(np.mean(have_inner)), 3), "inner_over_outer_radius_p10_p50_p90": [round(float(np.percentile(inner_ratio, q)), 2) for q in (10, 50, 90)] if inner_ratio else None,
    "palette": palette,
    "vanished_away_from_edge_per_min": round(ended / duration * 60, 1), "vanished_r12plus_per_min": round(ended12 / duration * 60, 1), "merge_like_per_min": round(merges / duration * 60, 1), "merge_examples": examples[:40], "vanished_examples": vanished,
}
json.dump(out, open(sys.argv[2], "w"), indent=1)
json.dump({"dt": dt, "frames_t": [f["t"] for f in frames], "tracks": good}, open(sys.argv[3], "w"))
print(json.dumps(out, indent=1))
