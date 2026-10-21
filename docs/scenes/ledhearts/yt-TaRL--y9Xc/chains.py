import sys, glob, numpy as np, cv2
from scipy import ndimage
fs = sorted(glob.glob(sys.argv[1] + "/f*.jpg")); FPS = 60
def objs(i):
    g = cv2.cvtColor(cv2.imread(fs[i]), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    b = cv2.GaussianBlur(g, (0, 0), 5.3); m = b > max(0.16, np.percentile(b, 60))
    lab, n = ndimage.label(m); o = []
    for k, sl in enumerate(ndimage.find_objects(lab), 1):
        mm = lab[sl] == k; a = mm.sum()
        if a < 200: continue
        ys, xs = np.nonzero(mm)
        o.append((xs.mean() + sl[1].start, ys.mean() + sl[0].start, np.sqrt(a), sl[1].stop - sl[1].start, sl[0].stop - sl[0].start, b[sl][mm].mean()))
    return np.array(o)
H, W = 720, 1280; hh = H / 2
F = [objs(i) for i in range(0, 360)]
res = []
for s in range(0, 300, 30):
    for o in F[s]:
        ch = [o]
        for t in range(s + 1, s + 30):
            B = F[t]; p = ch[-1]
            d = np.hypot(B[:, 0] - p[0], B[:, 1] - p[1]); j = np.argmin(d)
            if d[j] > 12 or abs(B[j, 2] - p[2]) / p[2] > 0.08: break
            ch.append(B[j])
        if len(ch) < 30: continue
        c = np.array(ch); tt = np.arange(30) / FPS
        grow = np.polyfit(tt, np.log(c[:, 2]), 1)[0]
        x = (c[:, 0] - W / 2) / hh; y = (c[:, 1] - H / 2) / hh
        r = np.hypot(x, y); rr = r.mean()
        vr = np.polyfit(tt, r, 1)[0]
        vx = np.polyfit(tt, x, 1)[0]; vy = np.polyfit(tt, y, 1)[0]
        asp = c[:, 3] / c[:, 4]
        dl = np.polyfit(tt, c[:, 5], 1)[0]
        res.append((c[:, 2].mean() / hh, grow, vr / max(rr, 0.05), rr, vx, vy, asp.max() - asp.min(), dl, c[:, 5].mean()))
R = np.array(res); print("chains", len(R))
o = np.argsort(R[:, 0])
print("size  grow/s  vr/r  r  vx  vy  aspSwing  dLum/s lum")
for b in np.array_split(o, 6):
    print(" ".join(f"{v:+.3f}" for v in np.median(R[b], 0)))
far = R[R[:, 3] > 0.3]
print("corr grow vs vr/r", np.corrcoef(far[:, 1], far[:, 2])[0, 1])
