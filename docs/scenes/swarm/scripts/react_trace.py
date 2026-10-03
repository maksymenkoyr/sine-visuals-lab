# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
"""react_trace.py <shotsDir> <bundleDir> <fromS> <toS> — per shot: time,
lit brightness and the swarm's outer radius (r95 of lit pixels), with the
librosa onsets (and their strength) marked, so a flash or thump can be seen
landing (or not) on the hits."""
import json, sys
import numpy as np, cv2

d, bundle, a, b = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
shots = [s for s in json.load(open(f"{d}/shots.json")) if a * 1000 <= s["ms"] <= b * 1000]
au = json.load(open(f"{bundle}/audio.json"))
onsets = [o for o in au["onsets"] if a <= o <= b]
low = {round(x["t"], 2) for x in au.get("beats", []) if isinstance(x, dict) and "t" in x}
k = 0
for s in shots:
    while k < len(onsets) and onsets[k] * 1000 <= s["ms"]:
        print(f"   ---- onset {onsets[k]:.3f}")
        k += 1
    f = cv2.imread(f"{d}/{s['file']}").astype(np.float32) / 255
    g = f.max(-1)
    ys, xs = np.nonzero(g > 0.1)
    cx, cy = xs.mean(), ys.mean()
    r95 = np.percentile(np.hypot(xs - cx, ys - cy), 95) / (f.shape[0] / 2)
    bar = "#" * int(g.mean() * 600)
    print(f"{s['ms'] / 1000:7.3f}  lum {g.mean():.4f}  r95 {r95:.3f}  {bar}")
