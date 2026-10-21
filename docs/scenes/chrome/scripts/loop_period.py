# /// script
# dependencies = ["numpy", "opencv-python-headless"]
# ///
# The loop length of a seamless VJ loop, and whether it drifts: mean frame-vs-
# frame correlation (grey, 160x90) at every lag, the best lags printed, then the
# global translation per second by phase correlation.
#   uv run docs/scenes/chrome/scripts/loop_period.py <video.mp4>
import sys, cv2, numpy as np
cap = cv2.VideoCapture(sys.argv[1]); fps = cap.get(cv2.CAP_PROP_FPS)
fr = []
while True:
    ok, f = cap.read()
    if not ok: break
    fr.append(cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (160, 90), interpolation=cv2.INTER_AREA).astype(np.float32))
F = np.stack(fr); F -= F.mean(axis=(1, 2), keepdims=True); F /= F.std(axis=(1, 2), keepdims=True)
n = len(F); print("frames", n, "fps", fps)
# mean frame-vs-frame correlation at each lag, over all start frames
lags = np.arange(1, int(n * 0.6))
c = np.array([np.mean(np.sum(F[:-L] * F[L:], axis=(1, 2)) / F[0].size) for L in lags])
best = np.argsort(-c)[:12]
for i in sorted(best, key=lambda i: -c[i])[:10]: print(f"lag {lags[i]/fps:7.3f}s corr {c[i]:.3f}")
for s in [0.5, 1, 2, 4, 8]:
    L = int(s * fps); print(f"at {s}s corr {c[L-1]:.3f}")
# translation per second via phase correlation (global drift)
sh = [cv2.phaseCorrelate(F[i], F[i + int(fps/4)])[0] for i in range(0, n - int(fps/4), int(fps))]
sh = np.array(sh) * 1280 / 160 * 4
print("global drift px/s (x,y) median", np.median(sh, axis=0), "spread", sh.std(axis=0))
