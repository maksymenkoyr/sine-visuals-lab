# How simple is the drops' motion? Fits, per window, three models to the 1 s track velocities:
# a shared translation; translation + rotation + uniform scale (a sheet moved as one); a full affine flow.
# Usage: field.py <trk.json> <out.json>
import json, sys
import numpy as np
trk = json.load(open(sys.argv[1])); dt = trk["dt"]; K = int(round(1 / dt))
rows = []
for t in trk["tracks"]:
    if np.median(t["r"]) < 12: continue
    fi = np.array(t["fi"]); x = np.array(t["x"]); y = np.array(t["y"])
    for i in range(0, len(fi) - K):
        j = np.searchsorted(fi, fi[i] + K)
        if j < len(fi) and fi[j] == fi[i] + K:
            rows.append(((x[i] + x[j]) / 2, (y[i] + y[j]) / 2, (x[j] - x[i]) / (K * dt), (y[j] - y[i]) / (K * dt), fi[i]))
r = np.array(rows)
X, Y = (r[:, 0] - 960) / 1920, (r[:, 1] - 540) / 1920; U, V = r[:, 2] / 19.2, r[:, 3] / 19.2  # %W per s; positions in frame widths from centre
def r2(pred):
    return 1 - float(((np.r_[U, V] - pred) ** 2).sum() / ((np.r_[U, V] - np.r_[U, V].mean()) ** 2).sum())
n = len(U)
# translation
tr = np.r_[np.full(n, np.median(U)), np.full(n, np.median(V))]
# similarity: u = a + s*x - w*y, v = b + s*y + w*x
A = np.zeros((2 * n, 4)); A[:n, 0] = 1; A[n:, 1] = 1; A[:n, 2] = X; A[n:, 2] = Y; A[:n, 3] = -Y; A[n:, 3] = X
b = np.r_[U, V]; sol, *_ = np.linalg.lstsq(A, b, rcond=None); a0, b0, s, w = sol
# affine: u = a + c x + d y, v = b + e x + f y
B = np.zeros((2 * n, 6)); B[:n, 0] = 1; B[:n, 1] = X; B[:n, 2] = Y; B[n:, 3] = 1; B[n:, 4] = X; B[n:, 5] = Y
sol2, *_ = np.linalg.lstsq(B, b, rcond=None)
# piecewise in time: does one field hold all window, or does it change? refit similarity per 3 s
times = r[:, 4]; spans = []
for t0 in np.arange(times.min(), times.max(), 3 / dt):
    m = (times >= t0) & (times < t0 + 3 / dt)
    if m.sum() < 30: continue
    Am = np.zeros((2 * m.sum(), 4)); Am[:m.sum(), 0] = 1; Am[m.sum():, 1] = 1
    Am[:m.sum(), 2] = X[m]; Am[m.sum():, 2] = Y[m]; Am[:m.sum(), 3] = -Y[m]; Am[m.sum():, 3] = X[m]
    bm = np.r_[U[m], V[m]]; s3, *_ = np.linalg.lstsq(Am, bm, rcond=None)
    pred = Am @ s3; spans.append({"t": round(float(t0 * dt), 1), "r2": round(1 - float(((bm - pred) ** 2).sum() / ((bm - bm.mean()) ** 2).sum()), 2), "tx": round(float(s3[0]), 2), "ty": round(float(s3[1]), 2), "rot_pct_per_s_per_W": round(float(s3[3]), 2), "scale": round(float(s3[2]), 2)})
cx, cy = None, None
if abs(w) > 1e-6 or abs(s) > 1e-6:
    D = s**2 + w**2
    cx = float(-(s * a0 + w * b0) / D); cy = float((w * a0 - s * b0) / D)
out = {"samples": n, "translation_r2": round(r2(tr), 3), "similarity_r2": round(r2(A @ sol), 3), "affine_r2": round(r2(B @ sol2), 3),
       "similarity": {"tx_pct_per_s": round(float(a0), 2), "ty_pct_per_s": round(float(b0), 2), "scale_pct_per_s_per_frame_width": round(float(s), 2), "rotation_pct_per_s_per_frame_width": round(float(w), 2), "rotation_deg_per_s": round(float(np.degrees(w / 100)), 2),
                      "still_point_frame_widths_from_centre_xy": [round(cx, 2), round(cy, 2)] if cx is not None else None},
       "per_3s": spans}
json.dump(out, open(sys.argv[2], "w"), indent=1); print(sys.argv[1], json.dumps({k: v for k, v in out.items()}))
