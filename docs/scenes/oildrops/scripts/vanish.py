# Before/after crops for drops >= 12 px that vanish away from the frame edge, following the shared drift.
# Usage: vanish.py <video> <an.json> <out.jpg> [maxRows]
import json, sys
import cv2, numpy as np
video, an, out = sys.argv[1:4]
n = int(sys.argv[4]) if len(sys.argv) > 4 else 10
ev = json.load(open(an))["vanished_examples"]
rng = np.random.default_rng(5); rng.shuffle(ev); ev = ev[:n]
cap = cv2.VideoCapture(video); FPS = 59.94; rows = []
for e in ev:
    S = int(max(70, 6 * e["r"])); row = []
    for off in (-0.8, -0.2, 0.2, 0.8):
        i = int(round((e["t"] + off) * FPS)); cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, f = cap.read()
        if not ok: continue
        # the crop rides the shared drift so a drop stays near the centre
        k = off / 1.0
        cx = int(np.clip(e["x"] + e["dx"] * k, S // 2, 1920 - S // 2)); cy = int(np.clip(e["y"] + e["dy"] * k, S // 2, 1080 - S // 2))
        c = cv2.resize(f[cy - S // 2:cy + S // 2, cx - S // 2:cx + S // 2], (200, 200), interpolation=cv2.INTER_AREA)
        cv2.circle(c, (100, 100), int(100 * e["r"] * 2 / S), (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(c, f"{off:+.1f}s r{e['r']}", (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
        row.append(c)
    if len(row) == 4: rows.append(np.hstack(row))
cap.release()
cv2.imwrite(out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 80]); print(out, len(rows), "of", len(json.load(open(an))["vanished_examples"]))
