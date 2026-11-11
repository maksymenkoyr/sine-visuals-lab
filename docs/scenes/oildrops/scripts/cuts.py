# Frame-accurate cuts in the downloaded slice, by colour-histogram distance between successive frames.
# Usage: cuts.py <video> <out.json> <outSheet.jpg>
import json, sys
import cv2, numpy as np
video, out, sheet = sys.argv[1:4]
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS); n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
print("fps", fps, "frames", n, "size", W, H, "dur", n / fps)
prev = None; d = []; i = 0; thumbs = {}
while True:
    ok, f = cap.read()
    if not ok: break
    s = cv2.resize(f, (160, 90), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(s, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1], None, [36, 16], [0, 180, 0, 256]); h = h / h.sum()
    d.append(0.0 if prev is None else float(0.5 * np.abs(h - prev).sum()))
    prev = h
    if i % int(round(fps)) == 0: thumbs[i] = cv2.resize(f, (320, 180), interpolation=cv2.INTER_AREA)
    i += 1
cap.release()
d = np.array(d); print("decoded", len(d))
med = np.median(d); thr = max(0.2, 8 * med)
idx = np.nonzero(d > thr)[0]
# group frames within 1 s: a cross-fade reads as a run of change frames
groups = []
for k in idx:
    if groups and k - groups[-1][-1] < fps: groups[-1].append(int(k))
    else: groups.append([int(k)])
cuts = [{"first": g[0], "last": g[-1], "t0": round(g[0] / fps, 3), "t1": round(g[-1] / fps, 3), "peak": round(float(d[g].max()), 3), "n": len(g)} for g in groups]
for c in cuts: print(c)
json.dump({"fps": fps, "n": len(d), "cuts": cuts, "median": med}, open(out, "w"), indent=1)
# one thumbnail per second, a row of ten per line
keys = sorted(thumbs); rows = []
for a in range(0, len(keys), 12):
    row = [thumbs[k].copy() for k in keys[a:a + 12]]
    for k, t in zip(keys[a:a + 12], row):
        cv2.putText(t, f"{k / fps:.0f}", (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
    while len(row) < 12: row.append(np.zeros_like(thumbs[keys[0]]))
    rows.append(np.hstack(row))
cv2.imwrite(sheet, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 80])
