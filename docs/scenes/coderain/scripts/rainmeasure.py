# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9", "pillow>=10.1", "scipy>=1.11"]
# ///
"""Measure glyph-rain structure on a still-camera stretch of the reference.

usage: uv run rainmeasure.py <video> <t0> <t1> <outdir>

Per frame: lit mask (green channel over a floor), dilated vertically so the
glyphs of one column merge into one strip; each strip = one rain column.
Per strip: x centre, width (glyph width at that depth), length (trail),
head = the lowest lit row (rain falls down), glyph pitch from the
autocorrelation of the strip's row profile. Strips are matched frame to
frame by x overlap; head dy/dt = fall speed. Texture motion: the strip's
row profile cross-correlated against the next frames — if it moves with the
head the whole string falls; if it stays put the glyphs are fixed and only a
brightness wave travels.
"""
import sys, json
import numpy as np, cv2
from scipy import ndimage as ndi
from PIL import Image

video, t0, t1, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS)
cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t0 * fps)))
frames = []
for _ in range(int(round((t1 - t0) * fps))):
    ok, f = cap.read()
    if not ok:
        break
    frames.append(f[:, :, ::-1].astype(np.float32) / 255.0)  # RGB
H, W = frames[0].shape[:2]
print(f"{len(frames)} frames {W}x{H} @ {fps:.2f}")

FLOOR = 0.16

def strips(img):
    g = img[:, :, 1]
    lit = g > FLOOR
    # merge glyphs of a column: close vertically (gap between glyphs), not horizontally
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15))
    m = cv2.morphologyEx(lit.astype(np.uint8), cv2.MORPH_CLOSE, k)
    lab, n = ndi.label(m)
    objs = ndi.find_objects(lab)
    res = []
    for i, sl in enumerate(objs):
        ys, xs = sl
        h = ys.stop - ys.start
        w = xs.stop - xs.start
        if h < 20 or w < 2:
            continue
        sub = (lab[sl] == i + 1)
        rows = sub.sum(1)
        # glyph width: 90th pct of the per-row lit width
        gw = float(np.percentile(rows[rows > 0], 90))
        prof = (g[sl] * sub).sum(1) / np.maximum(rows, 1)
        res.append(dict(x=float((xs.start + xs.stop) / 2), x0=xs.start, x1=xs.stop,
                        y0=ys.start, y1=ys.stop, w=gw, h=h, prof=prof,
                        rgb=img[sl][sub].mean(0)))
    return res

per = [strips(f) for f in frames]
print("strips/frame", np.median([len(p) for p in per]))

# pitch: autocorrelation of the row profile
def pitch(prof):
    p = prof - prof.mean()
    if len(p) < 24:
        return None
    ac = np.correlate(p, p, "full")[len(p) - 1:]
    ac /= ac[0] + 1e-9
    for lag in range(3, len(ac) // 2):
        if ac[lag] > ac[lag - 1] and ac[lag] >= ac[lag + 1] and ac[lag] > 0.25:
            return lag
    return None

rows = []
for s in per[len(per) // 2]:
    p = pitch(s["prof"])
    rows.append((s["w"], s["h"], p))
rows.sort()
print("\nwidth px | trail px | pitch px | trail in pitches | pitch/width")
for w, h, p in rows:
    if p:
        print(f"{w:5.1f} | {h:5d} | {p:4d} | {h / p:5.1f} | {p / w:4.2f}")

# head colour vs trail: in big strips, the bottom glyph vs the rest, along the strip
def head_trail(img, s):
    g = img[s["y0"]:s["y1"], s["x0"]:s["x1"]]
    lum = g.max(2)
    lit = lum > FLOOR
    ys = np.where(lit.any(1))[0]
    n = len(ys)
    seg = np.array_split(np.arange(s["y1"] - s["y0"]), 10)
    out = []
    for sg in seg:
        px = g[sg][lit[sg]]
        out.append(px.mean(0) if len(px) else np.zeros(3))
    return np.array(out)  # top (tail) .. bottom (head)

print("\ncolour along the trail, tail → head (RGB 0..255), widest strips:")
big = sorted(per[len(per) // 2], key=lambda s: -s["w"])[:6]
for s in big:
    ht = head_trail(frames[len(per) // 2], s)
    print(f"w {s['w']:.0f} h {s['h']}: " + " ".join("%02x%02x%02x" % tuple((c * 255).astype(int)) for c in ht))

# tracking: match strips between frame i and i+k by x overlap; head = y1
def match(a, b):
    best = None
    for s in b:
        ov = min(a["x1"], s["x1"]) - max(a["x0"], s["x0"])
        if ov > 0.6 * min(a["x1"] - a["x0"], s["x1"] - s["x0"]) and abs(a["w"] - s["w"]) < 0.4 * a["w"] + 2:
            if best is None or abs(s["y0"] - a["y0"]) + abs(s["y1"] - a["y1"]) < abs(best["y0"] - a["y0"]) + abs(best["y1"] - a["y1"]):
                best = s
    return best

K = 6  # frames apart (0.2 s)
print(f"\nhead speed and texture shift over {K} frames ({K / fps:.2f}s):")
speeds = []
for i in range(0, len(per) - K, 10):
    for a in per[i]:
        if a["h"] < 60 or a["w"] < 6:
            continue
        b = match(a, per[i + K])
        if not b:
            continue
        dh = b["y1"] - a["y1"]
        dt_ = b["y0"] - a["y0"]
        # texture: column of the frame (fixed x range) at i vs i+K; shift that best aligns
        x0, x1 = a["x0"], a["x1"]
        ya, yb = max(a["y0"], b["y0"]), min(a["y1"], b["y1"])
        if yb - ya < 40:
            continue
        pa = frames[i][ya:yb, x0:x1, 1].mean(1)
        best, bs = -1, 0
        for sh in range(-5, 60):
            lo, hi = ya + sh, yb + sh
            if lo < 0 or hi > H:
                continue
            pb = frames[i + K][lo:hi, x0:x1, 1].mean(1)
            c = np.corrcoef(pa, pb)[0, 1]
            if c > best:
                best, bs = c, sh
        p = pitch(a["prof"])
        speeds.append(dict(w=a["w"], pitch=p, head=dh, tail=dt_, tex=bs, r=best))
for s in sorted(speeds, key=lambda s: -s["w"])[:30]:
    pp = s["pitch"] or 0
    print(f"w {s['w']:5.1f} pitch {pp:3d} | head dy {s['head']:+4d} tail dy {s['tail']:+4d} texture shift {s['tex']:+3d} (r {s['r']:.2f})"
          + (f" | head {s['head'] / pp * fps / K:5.1f} pitch/s, texture {s['tex'] / pp * fps / K:5.1f} pitch/s" if pp else ""))
json.dump(dict(speeds=speeds), open(f"{out}/rain_speeds.json", "w"), default=float)

# depth distribution: strip width histogram (width ∝ 1/depth)
ws = np.array([s["w"] for p in per[::15] for s in p])
print("\nglyph width px percentiles (10,25,50,75,90,99):", np.percentile(ws, [10, 25, 50, 75, 90, 99]).round(1))
print("strips by width: <4 %d, 4-8 %d, 8-14 %d, 14-22 %d, >22 %d" % tuple(
    ((ws >= a) & (ws < b)).sum() // len(per[::15]) for a, b in [(0, 4), (4, 8), (8, 14), (14, 22), (22, 999)]))

# debug crop: the widest strip at native resolution over 4 frames
s = big[0]
x0, x1 = max(0, s["x0"] - 30), min(W, s["x1"] + 30)
tiles = [frames[j][:, x0:x1] for j in range(len(per) // 2, min(len(per), len(per) // 2 + 24), 6)]
Image.fromarray((np.concatenate(tiles, 1) * 255).astype(np.uint8)).save(f"{out}/rain_column.png")
print("wrote", f"{out}/rain_column.png")
