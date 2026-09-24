# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "opencv-python-headless", "scikit-learn"]
# ///
"""Measure a light-ground marbled still: luma bands, palette, ink rivers,
cell mosaic, speckle, bubbles. Prints a compact report; writes overlay PNGs
next to the input."""
import sys, json, math
from pathlib import Path
import numpy as np
import cv2
from sklearn.cluster import KMeans

src = Path(sys.argv[1])
out = Path(sys.argv[2]) if len(sys.argv) > 2 else src.parent
img = cv2.imread(str(src))
H, W = img.shape[:2]
hh = H / 2  # half-height unit
rgb = img[:, :, ::-1].astype(np.float32) / 255
luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
hue = hsv[..., 0] * 2  # degrees
sat = hsv[..., 1] / 255
val = hsv[..., 2] / 255
rep = {"frame": [W, H]}

# 1. luminance bands
edges = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.01]
hist, _ = np.histogram(luma, bins=edges)
rep["luma_shares"] = {f"{edges[i]:.2f}-{edges[i+1]:.2f}": round(float(hist[i] / luma.size), 3) for i in range(len(hist))}
rep["luma_median"] = round(float(np.median(luma)), 3)

# 2. palette (k-means in Lab, 7 clusters)
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
idx = np.random.default_rng(0).choice(lab.shape[0], 60000, replace=False)
km = KMeans(7, n_init=3, random_state=0).fit(lab[idx])
labels = km.predict(lab)
pal = []
for k in range(7):
    m = labels == k
    share = m.mean()
    c = cv2.cvtColor(km.cluster_centers_[k].reshape(1, 1, 3).astype(np.uint8), cv2.COLOR_LAB2BGR)[0, 0][::-1]
    pal.append({"hex": "#%02x%02x%02x" % tuple(int(v) for v in c), "share": round(float(share), 3),
                "luma": round(float((0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255), 2)})
pal.sort(key=lambda p: -p["share"])
rep["palette"] = pal

# 3. dark ink: luma < 0.3 and reddish OR very dark
ink = (luma < 0.32).astype(np.uint8)
ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab_cc, stats, cent = cv2.connectedComponentsWithStats(ink, 8)
comps = []
for i in range(1, n):
    a = stats[i, cv2.CC_STAT_AREA]
    if a < 0.0002 * W * H:
        continue
    ys, xs = np.where(lab_cc == i)
    pts = np.stack([xs, ys], 1).astype(np.float32)
    (cx, cy), (w, h), ang = cv2.minAreaRect(pts)
    major, minor = max(w, h), max(1, min(w, h))
    # skeleton-ish width: area / half perimeter via distance transform
    sub = (lab_cc == i).astype(np.uint8)
    dt = cv2.distanceTransform(sub, cv2.DIST_L2, 3)
    width = float(2 * np.median(dt[sub > 0][dt[sub > 0] > 0.5])) if (sub > 0).any() else 0
    hue_i = float(np.median(hue[sub > 0]))
    sat_i = float(np.median(sat[sub > 0]))
    comps.append({"area_frac": round(float(a / (W * H)), 4), "major_hh": round(major / hh, 3),
                  "elong": round(major / minor, 1), "width_px": round(width, 1),
                  "hue": round(hue_i), "sat": round(sat_i, 2)})
comps.sort(key=lambda c: -c["area_frac"])
rep["ink_total_share"] = round(float(ink.mean()), 3)
rep["ink_components_n"] = len(comps)
rep["ink_top"] = comps[:12]
rep["ink_width_px_median"] = round(float(np.median([c["width_px"] for c in comps])), 1) if comps else None
rep["ink_elong_median"] = round(float(np.median([c["elong"] for c in comps])), 1) if comps else None

# red vs olive split inside ink+midtones
mid = (luma >= 0.2) & (luma < 0.55) & (sat > 0.25)
h_mid = hue[mid]
rep["mid_hue_shares"] = {
    "red(330-20)": round(float(((h_mid > 330) | (h_mid < 20)).mean()), 3),
    "olive/yellow(30-90)": round(float(((h_mid >= 30) & (h_mid < 90)).mean()), 3),
    "violet/pink(280-330)": round(float(((h_mid >= 280) & (h_mid <= 330)).mean()), 3),
    "other": None,
}
rep["mid_hue_shares"]["other"] = round(1 - sum(v for v in rep["mid_hue_shares"].values() if v), 3)

# 4. cell mosaic: pale region, local darkening = lacing
pale = luma > 0.5
blur = cv2.GaussianBlur(luma, (0, 0), 12)
lace = (blur - luma > 0.06) & pale
lace_u8 = lace.astype(np.uint8)
lace_u8 = cv2.morphologyEx(lace_u8, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
rep["lace_share_of_pale"] = round(float(lace[pale].mean()), 3)
cells = ((~lace) & pale).astype(np.uint8)
cells = cv2.erode(cells, np.ones((3, 3), np.uint8))
n, cc, stats, _ = cv2.connectedComponentsWithStats(cells, 4)
areas = stats[1:, cv2.CC_STAT_AREA]
areas = areas[(areas > 0.00005 * W * H) & (areas < 0.02 * W * H)]
eq_d = 2 * np.sqrt(areas / math.pi) / hh
rep["cells_n"] = int(len(areas))
rep["cell_diam_hh_p25_50_75"] = [round(float(v), 3) for v in np.percentile(eq_d, [25, 50, 75])]
# lacing stroke width
dt = cv2.distanceTransform(lace_u8, cv2.DIST_L2, 3)
rep["lace_width_px_median"] = round(float(2 * np.median(dt[lace_u8 > 0])), 1)
# lacing darkness relative to cell interior
rep["lace_luma"] = round(float(np.median(luma[lace])), 3)
rep["cell_luma"] = round(float(np.median(luma[(cells > 0)])), 3)
rep["cell_interior_sat_median"] = round(float(np.median(sat[cells > 0])), 3)
rep["cell_interior_hue_median"] = round(float(np.median(hue[cells > 0])), 1)

# 5. speckle: small bright specks
spk = ((luma > 0.85) & (sat < 0.2)).astype(np.uint8)
n, cc, stats, _ = cv2.connectedComponentsWithStats(spk, 8)
sa = stats[1:, cv2.CC_STAT_AREA]
small = sa[(sa >= 2) & (sa < 0.0003 * W * H)]
rep["speckle_n"] = int(len(small))
rep["speckle_diam_px_median"] = round(float(2 * np.sqrt(np.median(small) / math.pi)), 1) if len(small) else None
rep["speckle_share"] = round(float(spk.mean()), 4)

# 6. bubbles: Hough circles on luma
g8 = (luma * 255).astype(np.uint8)
circ = cv2.HoughCircles(cv2.medianBlur(g8, 5), cv2.HOUGH_GRADIENT, 1.2, 40, param1=120, param2=40, minRadius=8, maxRadius=60)
rep["bubbles_n"] = 0 if circ is None else int(circ.shape[1])
if circ is not None:
    rep["bubble_r_hh"] = [round(float(r / hh), 3) for r in circ[0, :, 2][:10]]

# 7. spatial frequency of luma: radial power spectrum peak
small_l = cv2.resize(luma, (512, int(512 * H / W)))
f = np.abs(np.fft.fftshift(np.fft.fft2(small_l - small_l.mean()))) ** 2
cy, cx = np.array(f.shape) // 2
yy, xx = np.indices(f.shape)
rr = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2).astype(int)
prof = np.bincount(rr.ravel(), f.ravel()) / np.maximum(1, np.bincount(rr.ravel()))
prof = prof[1:min(cy, cx)]
k = np.arange(1, len(prof) + 1)
wl = (small_l.shape[0] / k) / (small_l.shape[0] / 2)  # wavelength in half-heights
top = np.argsort(prof * k)[-5:][::-1]  # energy per octave-ish
rep["dominant_wavelengths_hh"] = [round(float(wl[t]), 3) for t in top]

# overlays
ov = img.copy()
ov[ink > 0] = (0, 0, 255)
ov[lace] = (255, 200, 0)
ov[spk > 0] = (0, 255, 0)
cv2.imwrite(str(out / "pour-overlay.png"), cv2.resize(ov, (W // 2, H // 2)))
crop = img[H // 2 - 200:H // 2 + 200, W // 2 - 300:W // 2 + 300]
cv2.imwrite(str(out / "pour-centre-crop.png"), crop)
print(json.dumps(rep, indent=1))
