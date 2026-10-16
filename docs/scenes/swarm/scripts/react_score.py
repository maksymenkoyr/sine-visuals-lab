# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
"""react_score.py <shotsDir> <bundleDir> — how much the picture answers the
music: per shot, white-core r90, lit brightness and the frame-to-frame
change; then, around the bundle's librosa onsets, the mean change in the
first 200 ms after an onset vs everywhere else (a reaction ratio: 1 = the
picture doesn't care about hits)."""
import json, sys
import numpy as np, cv2

shots_dir, bundle = sys.argv[1], sys.argv[2]
shots = json.load(open(f"{shots_dir}/shots.json"))
audio = json.load(open(f"{bundle}/audio.json"))
onsets = np.array([o["t"] if isinstance(o, dict) else o for o in audio["onsets"]]) * 1000  # clip-relative
t, core, lum, diff = [], [], [], []
prev = None
for s in shots:
    f = cv2.imread(f"{shots_dir}/{s['file']}").astype(np.float32) / 255
    g = f.max(-1)
    h = f.shape[0]
    sat = f.max(-1) - f.min(-1)
    white = (g > 0.45) & (sat < 0.18)
    ys, xs = np.nonzero(g > 0.1)
    cx, cy = (xs.mean(), ys.mean()) if len(xs) else (f.shape[1] / 2, h / 2)
    yy, xx = np.nonzero(white)
    core.append(np.percentile(np.hypot(xx - cx, yy - cy), 90) / (h / 2) if len(xx) > 20 else np.nan)
    lum.append(g.mean())
    small = cv2.resize(g, (240, 135), interpolation=cv2.INTER_AREA)
    diff.append(np.abs(small - prev).mean() if prev is not None else np.nan)
    prev = small
    t.append(s["ms"])
t, core, lum, diff = map(np.array, (t, core, lum, diff))
dt = np.diff(t, prepend=t[0])
rate = diff / np.maximum(dt, 1) * 100  # change per 100 ms
after = np.zeros(len(t), bool)
for o in onsets:
    after |= (t - o >= 0) & (t - o < 200)
ok = ~np.isnan(rate)
r_after = np.nanmean(rate[after & ok])
r_else = np.nanmean(rate[~after & ok])
print(f"shots {len(t)} ({len(t) / ((t[-1] - t[0]) / 1000):.1f}/s), onsets in window {int(((onsets > t[0]) & (onsets < t[-1])).sum())}")
print(f"core r90 p10/p50/p90 {np.nanpercentile(core, 10):.2f}/{np.nanpercentile(core, 50):.2f}/{np.nanpercentile(core, 90):.2f}")
print(f"brightness mean {lum.mean():.4f}  p10/p90 {np.percentile(lum, 10):.4f}/{np.percentile(lum, 90):.4f}  (swing {(np.percentile(lum, 90) / max(np.percentile(lum, 10), 1e-6) - 1) * 100:.0f}%)")
print(f"change per 100 ms: after onset {r_after:.4f}  elsewhere {r_else:.4f}  ratio {r_after / r_else:.2f}")
