# Before/after crops around merge candidates, following the shared drift. Usage: merges.py <video> <an.json> <det.json> <out.jpg>
import json, sys
import cv2, numpy as np
video, an, det, out = sys.argv[1:5]
ev = json.load(open(an))["merge_examples"]
dt = json.load(open(det)); fr = dt["frames"]; ts = np.array([f["t"] for f in fr]); FPS = dt["fps"]
cap = cv2.VideoCapture(video); rows = []
for e in ev[:8]:
    S = int(max(90, 3.5 * e["into_r"]))
    row = []
    for off in (-1.0, -0.4, 0.0, 0.4, 1.0):
        i = int(round((e["t"] + off) * FPS)); cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, f = cap.read()
        if not ok: continue
        x0 = np.clip(e["x"] - S // 2, 0, 1920 - S); y0 = np.clip(e["y"] - S // 2, 0, 1080 - S)
        c = cv2.resize(f[y0:y0 + S, x0:x0 + S], (260, 260), interpolation=cv2.INTER_AREA)
        cv2.putText(c, f"{off:+.1f}s  r{e['r']}>{e['into_r']}", (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
        row.append(c)
    if len(row) == 5: rows.append(np.hstack(row))
cap.release()
if rows: cv2.imwrite(out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 82]); print(out, len(rows))
else: print("no events")
