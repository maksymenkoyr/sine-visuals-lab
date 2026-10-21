import sys, glob, json
import numpy as np, cv2
from scipy import ndimage

D = sys.argv[1]
fs = sorted(glob.glob(D + "/f*.jpg"))
FPS = 60
def load(i, scale=1.0):
    im = cv2.imread(fs[i])
    if scale != 1.0:
        im = cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return im

out = {}
# 1. loop period: distance of frame k to frame 0 (small grey)
g0 = cv2.cvtColor(load(0, 0.25), cv2.COLOR_BGR2GRAY).astype(np.float32)
d = []
for i in range(len(fs)):
    g = cv2.cvtColor(load(i, 0.25), cv2.COLOR_BGR2GRAY).astype(np.float32)
    d.append(float(np.mean(np.abs(g - g0))))
d = np.array(d)
cand = np.argsort(d[60:])[:5] + 60
out["loop_frames_best"] = [(int(c), round(c / FPS, 3), round(d[c], 2)) for c in cand]
out["dist_median"] = round(float(np.median(d)), 2)

# 2. LED pitch: autocorrelation of a bright patch
im = load(0)
g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
H, W = g.shape
F = np.abs(np.fft.rfft2(g - g.mean()))
F[:3, :3] = 0
fy = np.fft.fftfreq(H)[:, None]; fx = np.fft.rfftfreq(W)[None, :]
# strongest peak along x axis and y axis
rowx = F[0, 5:]; px = 1 / fx[0, 5 + np.argmax(rowx)]
coly = F[5:H // 2, 0]; py = 1 / fy[5 + np.argmax(coly), 0]
out["led_pitch_px"] = [round(float(px), 2), round(float(py), 2)]
# dot diameter: in a lit area, fraction of pixels above mid between dot max and gap min
lit = cv2.GaussianBlur(g, (0, 0), 6) > 0.35
vals = g[lit]
out["lit_dot_fill"] = round(float(np.mean(vals > (np.percentile(vals, 95) + np.percentile(vals, 5)) / 2)), 3)
out["dot_peak_gap"] = [round(float(np.percentile(vals, 95)), 3), round(float(np.percentile(vals, 5)), 3)]

# 3. hearts as objects: blur away the dot grid, threshold, components
def hearts(i):
    im = load(i)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    b = cv2.GaussianBlur(g, (0, 0), px * 0.8)
    m = b > max(0.16, np.percentile(b, 60))
    lab, n = ndimage.label(m)
    objs = []
    for k, sl in enumerate(ndimage.find_objects(lab), 1):
        mm = lab[sl] == k
        a = int(mm.sum())
        if a < 60: continue
        ys, xs = np.nonzero(mm)
        cy, cx = ys.mean() + sl[0].start, xs.mean() + sl[1].start
        h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        bb = b[sl][mm]; gg = g[sl][mm]
        # edge sharpness: gradient of blurred lum at boundary / brightness
        gy, gx = np.gradient(cv2.GaussianBlur(g, (0, 0), px * 0.8)[sl])
        edge = mm ^ ndimage.binary_erosion(mm)
        sharp = float(np.hypot(gx, gy)[edge].mean() / (bb.mean() + 1e-6))
        # dot contrast inside (in-focus LEDs show grid; out-of-focus smooth)
        dotc = float(np.std(gg - bb) / (bb.mean() + 1e-6))
        hue = float(np.median(hsv[sl][..., 0][mm])) * 2
        sat = float(np.median(hsv[sl][..., 1][mm])) / 255
        # orientation by moments
        mu = cv2.moments(mm.astype(np.uint8))
        ang = 0.5 * np.degrees(np.arctan2(2 * mu["mu11"], mu["mu20"] - mu["mu02"])) if mu["m00"] else 0
        objs.append(dict(cx=cx, cy=cy, w=w, h=h, area=a, lum=float(bb.mean()), peak=float(gg.max()),
                         sharp=sharp, dotc=dotc, hue=hue, sat=sat, ang=float(ang)))
    return objs

frames = [hearts(i) for i in range(0, 240, 2)]
# sizes in half-heights (H/2)
hh = H / 2
allo = [o for f in frames[:1] for o in f]
sz = np.array([max(o["w"], o["h"]) / hh for o in allo])
out["heart_count_frame0"] = len(allo)
out["heart_size_hh_pct"] = [round(float(np.percentile(sz, p)), 3) for p in (10, 25, 50, 75, 90, 99)]
# size vs lum / sharpness / dot contrast
order = np.argsort(sz)
bands = np.array_split(order, 5)
out["by_size"] = [dict(size=round(float(sz[b].mean()), 3),
                       lum=round(float(np.mean([allo[i]["lum"] for i in b])), 3),
                       sharp=round(float(np.mean([allo[i]["sharp"] for i in b])), 3),
                       dotc=round(float(np.mean([allo[i]["dotc"] for i in b])), 3),
                       hue=round(float(np.median([allo[i]["hue"] for i in b])), 0),
                       sat=round(float(np.mean([allo[i]["sat"] for i in b])), 2),
                       aspect=round(float(np.mean([allo[i]["w"] / allo[i]["h"] for i in b])), 2))
                  for b in bands]
hues = np.array([o["hue"] for o in allo]); ar = np.array([o["area"] for o in allo])
hb = {"magenta 285-315": ((hues >= 285) & (hues < 315)), "rose/red 315-360+0-15": ((hues >= 315) | (hues < 15)),
      "violet/blue 230-285": ((hues >= 230) & (hues < 285))}
out["hue_area_share"] = {k: round(float(ar[v].sum() / ar.sum()), 3) for k, v in hb.items()}

# 4. motion: nearest-neighbour tracks between sampled frames (dt = 2 frames)
vel = []
for a, b in zip(frames[:-1], frames[1:]):
    if not a or not b: continue
    B = np.array([[o["cx"], o["cy"], max(o["w"], o["h"])] for o in b])
    for o in a:
        s = max(o["w"], o["h"])
        dd = np.hypot(B[:, 0] - o["cx"], B[:, 1] - o["cy"])
        j = int(np.argmin(dd))
        if dd[j] < 25 and abs(B[j, 2] - s) / s < 0.25 and s > 15:
            dt = 2 / FPS
            vel.append((s / hh, (B[j, 0] - o["cx"]) / hh / dt, (B[j, 1] - o["cy"]) / hh / dt,
                        (B[j, 2] - s) / s / dt, o["cx"] / W, o["cy"] / H))
vel = np.array(vel)
out["tracks"] = len(vel)
order = np.argsort(vel[:, 0]); bands = np.array_split(order, 5)
out["motion_by_size"] = [dict(size=round(float(vel[b, 0].mean()), 3),
                              vx=round(float(np.median(vel[b, 1])), 3), vy=round(float(np.median(vel[b, 2])), 3),
                              grow_per_s=round(float(np.median(vel[b, 3])), 3)) for b in bands]
# radial component vs position (zoom from centre?)
rx = (vel[:, 4] - 0.5) * W / hh; ry = (vel[:, 5] - 0.5) * H / hh
r = np.hypot(rx, ry) + 1e-6
vr = (vel[:, 1] * rx + vel[:, 2] * ry) / r
rb = np.digitize(r, [0.3, 0.6, 0.9, 1.3])
out["radial_speed_by_r"] = [(int(k), round(float(np.median(vr[rb == k])), 3), int((rb == k).sum())) for k in range(5)]
json.dump(out, sys.stdout, indent=1)
