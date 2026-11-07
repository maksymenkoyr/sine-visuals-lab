# Measures a clip of a full-frame noise picture so the reference and ours
# read on the same scale: measure.py <ffmpeg> <video> [start] [dur] [fps]
# Everything is computed at 640x360 (temporal lags at 160x90), value V =
# max(R,G,B) because the picture is one saturated hue family.
import subprocess
import sys

import cv2
import numpy as np

ff, src = sys.argv[1], sys.argv[2]
W, H = 640, 360
STILLS = src.endswith(".png")
if STILLS:  # measure.py <ffmpeg> a.png b.png ...: spatial numbers only
    paths = [a for a in sys.argv[2:] if a.endswith(".png")]
    F = np.stack([cv2.resize(cv2.cvtColor(cv2.imread(p), cv2.COLOR_BGR2RGB), (W, H), interpolation=cv2.INTER_AREA)
                  for p in paths])
    n, fps = len(F), 1.0
else:
    start = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    dur = float(sys.argv[4]) if len(sys.argv) > 4 else 60.0
    fps = float(sys.argv[5]) if len(sys.argv) > 5 else 8.0
    raw = subprocess.run(
        [ff, "-v", "error", "-ss", str(start), "-t", str(dur), "-i", src,
         "-vf", f"fps={fps},scale={W}:{H}:flags=area", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
        capture_output=True,
    ).stdout
    n = len(raw) // (W * H * 3)
    F = np.frombuffer(raw[: n * W * H * 3], np.uint8).reshape(n, H, W, 3)
print(f"{src.split('/')[-1]}: {n} frames at {fps} fps ({n / fps:.1f} s)")

sub = F[:: max(1, n // 24)].astype(np.float32) / 255
R, G, B = sub[..., 0], sub[..., 1], sub[..., 2]
V = sub.max(-1)

# --- colour: tone ramp per value band, and where violet and white live
print("\nV band   share   mean R    G    B   violet%  white%")
violet = (B > 0.45 * R) & (B > G)
white = G > 0.35
edges = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01]
for lo, hi in zip(edges[:-1], edges[1:]):
    m = (V >= lo) & (V < hi)
    if m.sum() == 0:
        continue
    print(f"{lo:.2f}-{min(hi, 1):.2f}  {m.mean():.3f}   {R[m].mean():.3f} {G[m].mean():.3f} {B[m].mean():.3f}"
          f"   {violet[m].mean() * 100:5.1f}   {white[m].mean() * 100:5.1f}")
pv = np.percentile(V, [5, 25, 50, 75, 95, 99])
print("V pct 5/25/50/75/95/99:", pv.round(3), f" share V<0.10 {np.mean(V < 0.10):.3f}  V<0.15 {np.mean(V < 0.15):.3f}")
print(f"violet share {violet.mean():.3f} (of V>0.1: {violet[V > 0.1].mean():.3f})  white share {white.mean():.4f}")
hue = (np.degrees(np.arctan2(np.sqrt(3) * (G - B), 2 * R - G - B)) + 360) % 360
lit = V > 0.2
for name, a, b in (("red 345-15", 345, 15), ("rose 315-345", 315, 345), ("magenta 285-315", 285, 315),
                   ("violet 255-285", 255, 285)):
    sel = ((hue >= a) | (hue < b)) if a > b else ((hue >= a) & (hue < b))
    print(f"  hue {name}: {np.mean(sel[lit]):.3f}", end="")
print()

# --- spatial scale
ac = []
for v in V[:12]:
    x = v - v.mean()
    A = np.fft.ifft2(np.abs(np.fft.fft2(x)) ** 2).real
    A /= A[0, 0]
    ac.append([(A[0, r] + A[r, 0]) / 2 for r in (2, 4, 8, 16, 32, 64, 128)])
print("autocorr of V at r=2,4,8,16,32,64,128 px (640x360):", np.mean(ac, 0).round(3))
ps = []
for v in V[:12]:
    P = np.abs(np.fft.fftshift(np.fft.fft2((v - v.mean()) * np.outer(np.hanning(H), np.hanning(W))))) ** 2
    yy, xx = np.indices(P.shape)
    k = np.hypot((xx - W / 2) / W, (yy - H / 2) / H) * W
    ks = np.arange(4, 120)
    prof = np.array([P[(k >= a) & (k < a + 1)].mean() for a in ks])
    ps.append(np.polyfit(np.log(ks), np.log(prof), 1)[0])
print(f"power spectrum slope (k 4..120 cycles/width): {np.mean(ps):.2f}")
bands = np.zeros(7)
for v in V[:12]:
    P = np.abs(np.fft.fftshift(np.fft.fft2(v - v.mean()))) ** 2
    yy, xx = np.indices(P.shape)
    k = np.hypot((xx - W / 2) / W, (yy - H / 2) / H) * W
    for b in range(7):
        bands[b] += P[(k >= 2 ** (b + 1)) & (k < 2 ** (b + 2))].sum()
bands /= bands.sum()
print("power share by octave (cycles/width 2-4,4-8,8-16,16-32,32-64,64-128,128-256):", (bands * 100).round(1))
thin = [np.mean((v - cv2.GaussianBlur(v, (0, 0), 3.0)) > 0.10) for v in V[:12]]
coarse_sd = [cv2.GaussianBlur(v, (0, 0), 16.0).std() for v in V[:12]]
fine_sd = [(v - cv2.GaussianBlur(v, (0, 0), 16.0)).std() for v in V[:12]]
print(f"thin-bright share (V - blur3 > 0.10): {np.mean(thin):.4f}; coarse sd (blur16) {np.mean(coarse_sd):.3f}, "
      f"fine sd {np.mean(fine_sd):.3f}")
# Where the detail sits: local fine-detail energy (|V - blur3| smoothed over
# ~0.07 hh); a picture with smooth zones and lacy zones spreads it widely.
loc = []
for v in V[:12]:
    e = cv2.GaussianBlur(np.abs(v - cv2.GaussianBlur(v, (0, 0), 3.0)), (0, 0), 12.0)
    loc.append(e / e.mean())
loc = np.array(loc)
print(f"detail spread: local fine energy / mean, p10 {np.percentile(loc, 10):.2f} p50 {np.percentile(loc, 50):.2f} "
      f"p90 {np.percentile(loc, 90):.2f}, cv {loc.std() / loc.mean():.2f}")
corr_db = []
for v, e in zip(V[:12], loc):
    b = cv2.GaussianBlur(v, (0, 0), 12.0)
    corr_db.append(np.corrcoef(b.ravel(), e.ravel())[0, 1])
print(f"detail vs local brightness correlation: {np.mean(corr_db):+.2f}")

# dark channels: connected regions of V<0.12, size in half-heights
dark_areas = []
for v in V[:12]:
    nl, lab, st, _ = cv2.connectedComponentsWithStats((v < 0.12).astype(np.uint8), connectivity=8)
    dark_areas += list(st[1:, cv2.CC_STAT_AREA])
da = np.array(dark_areas) / (H / 2) ** 2
big = da[da > 0.001]
print(f"dark pockets (V<0.12) per frame {len(big) / 12:.1f}; area p50 {np.median(big):.4f} p90 {np.percentile(big, 90):.4f} hh^2"
      if len(big) else "dark pockets: none")

if STILLS:
    sys.exit(0)

# --- time: brightness drift, decorrelation by scale
fm = F.astype(np.float32).max(-1).mean((1, 2)) / 255
fs = F.astype(np.float32).max(-1).std((1, 2)) / 255
print(f"\nframe-mean V {fm.mean():.3f} ± {fm.std():.3f}; frame std {fs.mean():.3f} ± {fs.std():.3f}")
g_small = np.stack([cv2.resize(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (160, 90), interpolation=cv2.INTER_AREA)
                    for f in F]).astype(np.float32)
g_full = np.stack([cv2.cvtColor(f, cv2.COLOR_RGB2GRAY) for f in F]).astype(np.float32)
fine = np.stack([g - cv2.GaussianBlur(g, (0, 0), 2.0) for g in g_full])
coarse = np.stack([cv2.GaussianBlur(g, (0, 0), 3.0) for g in g_small])


def lagcorr(X, lag):
    a = X[:-lag].reshape(len(X) - lag, -1)
    b = X[lag:].reshape(len(X) - lag, -1)
    a = a - a.mean(1, keepdims=True)
    b = b - b.mean(1, keepdims=True)
    return float(np.mean((a * b).sum(1) / np.sqrt((a * a).sum(1) * (b * b).sum(1))))


row = []
for s in (0.25, 0.5, 1, 2, 3, 5, 8):
    L = int(round(s * fps))
    if 0 < L < n:
        row.append(f"{s}s all {lagcorr(g_small, L):.2f} coarse {lagcorr(coarse, L):.2f} fine {lagcorr(fine, L):.2f}")
print("frame correlation:\n  " + "\n  ".join(row))

# --- motion: global shift, optical flow speed, coherence, persistence
shifts = []
L = int(round(0.5 * fps))
for i in range(0, n - L, max(1, (n - L) // 30)):
    (dx, dy), resp = cv2.phaseCorrelate(g_full[i], g_full[i + L])
    shifts.append((dx, dy, resp))
sh = np.array(shifts)
print(f"\nglobal shift over 0.5 s (phase corr): mean ({sh[:, 0].mean():+.2f}, {sh[:, 1].mean():+.2f}) px, "
      f"|shift| p50 {np.median(np.hypot(sh[:, 0], sh[:, 1])):.2f} px, response p50 {np.median(sh[:, 2]):.3f}")

flows = []
idx = list(range(0, n - 1, max(1, (n - 1) // 40)))
for i in idx:
    fl = cv2.calcOpticalFlowFarneback(g_full[i].astype(np.uint8), g_full[i + 1].astype(np.uint8), None,
                                      0.5, 4, 21, 3, 5, 1.1, 0)
    flows.append(fl * fps)  # px/s at 640x360
flows = np.array(flows)
grad = np.stack([np.hypot(*np.gradient(cv2.GaussianBlur(g_full[i], (0, 0), 1.0))) for i in idx])
tex = grad > np.percentile(grad, 60)
sp = np.hypot(flows[..., 0], flows[..., 1])
print(f"flow speed on textured pixels: p50 {np.median(sp[tex]) / (H / 2):.3f} p90 {np.percentile(sp[tex], 90) / (H / 2):.3f} half-heights/s")
mv = flows[..., 0][tex].mean(), flows[..., 1][tex].mean()
print(f"mean flow vector ({mv[0] / (H / 2):+.4f}, {mv[1] / (H / 2):+.4f}) half-heights/s (+x right, +y down)")
coh = []
for fl in flows:
    for y in range(0, H - 40, 40):
        for x in range(0, W - 40, 40):
            w = fl[y:y + 40, x:x + 40].reshape(-1, 2)
            m = np.linalg.norm(w.mean(0))
            s = np.linalg.norm(w, axis=1).mean()
            if s > 1e-3:
                coh.append(m / s)
print(f"local coherence (|mean v| / mean|v| in 40 px windows): p50 {np.median(coh):.2f} (1 = all one way, ~0.1 = random)")
step = int(round(1.0 * fps))
pers = []
for j in range(len(idx)):
    for k in range(j + 1, len(idx)):
        if idx[k] - idx[j] == step or abs((idx[k] - idx[j]) - step) <= 1:
            a, b = flows[j].reshape(-1, 2), flows[k].reshape(-1, 2)
            pers.append(float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum())))
            break
print(f"flow persistence (vector correlation of flow fields ~1 s apart): {np.mean(pers):.2f}" if pers else "")
curl, div = [], []
for fl in flows:
    u, v = cv2.GaussianBlur(fl[..., 0], (0, 0), 3), cv2.GaussianBlur(fl[..., 1], (0, 0), 3)
    du_dy, du_dx = np.gradient(u)
    dv_dy, dv_dx = np.gradient(v)
    curl.append(np.sqrt(np.mean((dv_dx - du_dy) ** 2)))
    div.append(np.sqrt(np.mean((du_dx + dv_dy) ** 2)))
print(f"rms curl {np.mean(curl):.3f} vs rms divergence {np.mean(div):.3f} (1/s)")
