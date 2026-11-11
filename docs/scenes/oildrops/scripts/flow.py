# Paint motion between the drops, and whether drops ride that motion. Dense flow at the same width
# and settings as the pour measurements, every second over pairs half a second apart.
# Usage: flow.py <video> <det.json> <tracks.json> <out.json>
import json, sys
import cv2
import numpy as np

video, det_path, trk_path, out_path = sys.argv[1:5]
det = json.load(open(det_path)); trk = json.load(open(trk_path))
frames = det["frames"]; dt = det["step"] / det["fps"]; FPS = det["fps"]
W = 960; SCALE = 0.5
tracks = [t for t in trk["tracks"] if np.median(t["r"]) >= 12]
ts = np.array([f["t"] for f in frames])
cap = cv2.VideoCapture(video)

def gray_at(i):
    cap.set(cv2.CAP_PROP_POS_FRAMES, i)
    ok, f = cap.read()
    return cv2.cvtColor(cv2.resize(f, (W, 540), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY) if ok else None

speeds, vecs, pairs_all = [], [], []
start = frames[0]["i"]; end = frames[-1]["i"]
for i0 in range(start, end - 30, 60):
    g0, g1 = gray_at(i0), gray_at(i0 + 30)
    if g0 is None or g1 is None:
        continue
    fl = cv2.calcOpticalFlowFarneback(g0, g1, None, 0.5, 5, 25, 5, 7, 1.5, 0) / (30 / FPS)  # px/s at 960
    k = int(np.argmin(np.abs(ts - i0 / FPS)))
    yy, xx = np.ogrid[:540, :W]
    paint = np.ones((540, W), bool)
    for d in frames[k]["drops"]:
        paint &= (xx - d["x"] * SCALE) ** 2 + (yy - d["y"] * SCALE) ** 2 > (1.15 * d["r"] * SCALE + 2) ** 2
    if paint.mean() < 0.02:
        continue
    s = np.hypot(fl[..., 0], fl[..., 1])[paint]
    speeds.append(s)
    vecs.append((float(np.median(fl[..., 0][paint])), float(np.median(fl[..., 1][paint]))))
    # local paint velocity around each tracked drop, against the drop's own velocity
    for t in tracks:
        fi = np.array(t["fi"])
        a = np.searchsorted(fi, k); b = np.searchsorted(fi, k + 3)
        if a >= len(fi) or b >= len(fi) or fi[a] != k or fi[b] != k + 3:
            continue
        T = 3 * dt
        vd = ((t["x"][b] - t["x"][a]) * SCALE / T, (t["y"][b] - t["y"][a]) * SCALE / T)
        x, y, r = t["x"][a] * SCALE, t["y"][a] * SCALE, t["r"][a] * SCALE
        x0, x1 = max(0, int(x - 2.3 * r)), min(W, int(x + 2.3 * r) + 1); y0, y1 = max(0, int(y - 2.3 * r)), min(540, int(y + 2.3 * r) + 1)
        yy2, xx2 = np.ogrid[y0:y1, x0:x1]
        d2 = (xx2 - x) ** 2 + (yy2 - y) ** 2
        ann = (d2 >= (1.3 * r) ** 2) & (d2 <= (2.2 * r) ** 2) & paint[y0:y1, x0:x1]
        if ann.sum() >= 40:
            sub = fl[y0:y1, x0:x1][ann]
            pairs_all.append((vd[0], vd[1], float(np.median(sub[:, 0])), float(np.median(sub[:, 1])), float(np.median(t["r"]))))
cap.release()
s = np.concatenate(speeds)
vecs = np.array(vecs)
pct = lambda v: round(float(v) / W * 100, 3)
res = {"pairs_of_frames": len(speeds), "paint_speed_pct_per_s_p50_p90_p99": [pct(np.percentile(s, q)) for q in (50, 90, 99)],
       "paint_median_vector_pct_per_s_vx_vy": [pct(np.median(vecs[:, 0])), pct(np.median(vecs[:, 1]))]}
p = np.array(pairs_all)
if len(p) > 20:
    vd = p[:, :2].ravel(); vp = p[:, 2:4].ravel()
    a = float((vd * vp).sum() / (vp * vp).sum())
    r2 = 1 - float(((vd - a * vp) ** 2).sum() / (vd**2).sum())
    # the same with the shared motion taken away, so only local differences have to agree
    vd2 = (p[:, :2] - np.median(p[:, :2], axis=0)).ravel(); vp2 = (p[:, 2:4] - np.median(p[:, 2:4], axis=0)).ravel()
    a2 = float((vd2 * vp2).sum() / (vp2 * vp2).sum())
    r22 = 1 - float(((vd2 - a2 * vp2) ** 2).sum() / (vd2**2).sum())
    res.update({"drop_vs_local_paint": {"samples": len(p), "slope": round(a, 2), "r2": round(r2, 2), "slope_shared_motion_removed": round(a2, 2), "r2_shared_motion_removed": round(r22, 2),
                                         "drop_speed_over_paint_speed_p50": round(float(np.median(np.hypot(p[:, 0], p[:, 1]) / np.maximum(np.hypot(p[:, 2], p[:, 3]), 1e-3))), 2)}})
json.dump(res, open(out_path, "w"), indent=1)
print(json.dumps(res, indent=1))
