# One frame through the circle detector: prints a summary and saves the overlay. Usage: see2.py <video> <t> <out.jpg> [width]
import sys, time
import cv2, numpy as np
sys.path.insert(0, "/Users/yaro/.claude/jobs/43f57e00/tmp/oil/tools")
import circles as C
video, t, fam, out = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
width = int(sys.argv[5]) if len(sys.argv) > 5 else 1600
cap = cv2.VideoCapture(video); cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000); ok, f = cap.read(); cap.release()
t0 = time.time(); ds = C.detect(f, fam); dt = time.time() - t0
r = np.array([d["r"] for d in ds]); s = np.array([d["sup"] for d in ds])
print(f"t={t}: {len(ds)} circles in {dt:.1f}s; r p10/50/90 {np.percentile(r,[10,50,90]).round(1)} max {r.max():.0f}; support median {np.median(s):.2f}")
print("by r bin:", {f"{a}-{b}": int(((r >= a) & (r < b)).sum()) for a, b in [(3,6),(6,12),(12,24),(24,48),(48,96),(96,300)]})
vis = C.overlay(f, ds)
if width != f.shape[1]: vis = cv2.resize(vis, (width, int(f.shape[0] * width / f.shape[1])), interpolation=cv2.INTER_AREA)
cv2.imwrite(out, vis, [cv2.IMWRITE_JPEG_QUALITY, 85])
