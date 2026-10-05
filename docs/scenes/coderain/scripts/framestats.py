# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "scipy>=1.11"]
# ///
"""Rain statistics per still frame, the same definitions as rainmeasure.py:
lit share (green > FLOOR), strips (columns merged vertically), glyph-width
percentiles, colour along the widest trails.

usage: uv run framestats.py <png|jpg>... [--crop-ui]
"""
import sys
import numpy as np, cv2
from scipy import ndimage as ndi

FLOOR = 0.16
files = [a for a in sys.argv[1:] if not a.startswith("--")]
crop_ui = "--crop-ui" in sys.argv
allw, lits, counts = [], [], []
for f in files:
    img = cv2.imread(f)[:, :, ::-1].astype(np.float32) / 255.0
    if img.shape[0] != 720:
        img = cv2.resize(img, (1280, 720), interpolation=cv2.INTER_AREA)
    if crop_ui:  # mask the app chrome (top bar, bottom buttons)
        img[:60] = 0
        img[655:] = 0
    g = img[:, :, 1]
    lit = g > FLOOR
    lits.append(lit.mean())
    m = cv2.morphologyEx(lit.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15)))
    lab, n = ndi.label(m)
    ws = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        h = sl[0].stop - sl[0].start
        if h < 20 or sl[1].stop - sl[1].start < 2:
            continue
        rows = (lab[sl] == i + 1).sum(1)
        ws.append(float(np.percentile(rows[rows > 0], 90)))
    counts.append(len(ws))
    allw += ws
ws = np.array(allw)
print(f"frames {len(files)}  lit share {np.mean(lits) * 100:.1f}%  strips/frame {np.median(counts):.0f}")
print("glyph width px pct (10,25,50,75,90,99):", np.percentile(ws, [10, 25, 50, 75, 90, 99]).round(1))
n = len(files)
print("strips by width /frame: <4 %d, 4-8 %d, 8-14 %d, 14-22 %d, >22 %d" % tuple(
    ((ws >= a) & (ws < b)).sum() // n for a, b in [(0, 4), (4, 8), (8, 14), (14, 22), (22, 999)]))
