# Finds oil droplets in one frame of a liquid clip: per-colour masks, cut along the thin rim lines
# between touching drops, split by distance-transform watershed, one record per drop.
# Radii are pixels at the frame's own width; every caller reports them as % of frame width.
import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage.morphology import reconstruction
from skimage.segmentation import watershed

# name: list of (hue0, hue1, sat_min, val_min), hue in degrees and allowed to wrap past 360
CLASSES = {
    "redblue": {  # the 1:10:03 family: red, magenta, orange on blue glitter paint
        "red": [(345, 375, 0.60, 0.30)],
        "magenta": [(285, 344, 0.32, 0.35)],
        "orange": [(16, 52, 0.55, 0.45)],
    },
    "packed": {  # the 1:11:50 family: pink, orange, yellow, olive on dark blue
        "pink": [(292, 352, 0.22, 0.30)],
        "orange": [(353, 372, 0.55, 0.40), (12, 41, 0.50, 0.40)],
        "yellow": [(42, 85, 0.40, 0.35)],
        "purple": [(262, 291, 0.25, 0.25)],
    },
}
REL_SADDLE = 0.17   # a neck must narrow by this share of the peak width to split two drops
MIN_R_PX = 2.5      # below this a blob at 1920 px is noise, compression or a glitter fleck
RIDGE_AREA = 60     # thin-line fragments smaller than this are glitter, not a rim between drops


def hsv_of(bgr):
    f = cv2.GaussianBlur(bgr, (0, 0), 1.2).astype(np.float32) / 255.0
    return cv2.cvtColor(f, cv2.COLOR_BGR2HSV)


def hue_in(h, a, b):
    return ((h >= a) & (h <= b)) | ((h + 360 >= a) & (h + 360 <= b))


def ridges(bgr):
    """Thin dark or bright lines: the rim drawn between two touching drops."""
    g = cv2.GaussianBlur(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), (0, 0), 0.8).astype(np.float32) / 255.0
    se = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    bth = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, se)
    wth = cv2.morphologyEx(g, cv2.MORPH_TOPHAT, se)
    m = ((bth > 0.07) | (wth > 0.14)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = np.zeros(n, np.uint8)
    for i in range(1, n):
        w, h, a = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT], st[i, cv2.CC_STAT_AREA]
        # a rim fragment is long and thin; a glitter point is compact
        if a >= RIDGE_AREA and max(w, h) >= 18:
            keep[i] = 1
    return keep[lab].astype(bool)


def split(mask):
    """Boolean mask -> label image, one label per drop, by relative h-maxima of the distance map."""
    d = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5).astype(np.float64)
    if d.max() <= 0:
        return np.zeros(mask.shape, np.int32)
    log = np.log1p(d)
    h = -np.log1p(-REL_SADDLE)
    peaks = log - reconstruction(np.maximum(log - h, 0), log, method="dilation")
    markers, _ = ndi.label((peaks > 1e-6) & (d >= 1.0))
    return watershed(-d, markers, mask=mask)


def detect(bgr, family):
    H, W = bgr.shape[:2]
    hsv = hsv_of(bgr)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    ridge = ridges(bgr)
    out = []
    for name, ranges in CLASSES[family].items():
        m = np.zeros((H, W), bool)
        for a, b, smin, vmin in ranges:
            m |= hue_in(h, a, b) & (s >= smin) & (v >= vmin)
        filled = ndi.binary_fill_holes(m)
        cut = filled & ~ridge
        cut = ndi.binary_opening(cut, structure=cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)).astype(bool))
        lab = split(cut)
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            if sl is None:
                continue
            y0, x0 = sl[0].start, sl[1].start
            piece = (lab[sl] == i).astype(np.uint8)
            area = float(piece.sum())
            if area < np.pi * MIN_R_PX**2:
                continue
            cnts, _ = cv2.findContours(piece, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            c = max(cnts, key=cv2.contourArea)
            (cx, cy), re = cv2.minEnclosingCircle(c)
            hull = cv2.contourArea(cv2.convexHull(c)) or 1.0
            mom = cv2.moments(piece, binaryImage=True)
            out.append({
                "cls": name,
                "x": x0 + mom["m10"] / mom["m00"], "y": y0 + mom["m01"] / mom["m00"],
                "r": float(np.sqrt(area / np.pi)),  # equivalent-area radius
                "re": re + 0.5, "ex": x0 + cx, "ey": y0 + cy,
                "area": area,
                "round": min(1.0, area / (np.pi * (re + 0.5) ** 2)),
                "solid": min(1.0, area / hull),
                "edge": bool(x0 <= 1 or y0 <= 1 or sl[1].stop >= W - 1 or sl[0].stop >= H - 1),
            })
    return out, ridge


COL = {"red": (0, 255, 255), "magenta": (0, 255, 0), "orange": (255, 255, 0), "pink": (0, 255, 255), "yellow": (255, 0, 255), "purple": (0, 255, 0)}


def overlay(bgr, drops, min_round=0.0):
    vis = bgr.copy()
    for d in drops:
        if d["round"] < min_round:
            continue
        cv2.circle(vis, (int(round(d["x"])), int(round(d["y"]))), int(round(d["r"])), COL.get(d["cls"], (255, 255, 255)), 1, cv2.LINE_AA)
    return vis
